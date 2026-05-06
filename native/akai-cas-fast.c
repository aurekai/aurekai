/*
 * akai-cas-fast — Zero-copy CAS blob import operator in C
 *
 * Imports a file into the CAS store via:
 *   1. mmap the source file (read-only)
 *   2. Compute SHA-256 content address
 *   3. Check if blob already exists (idempotent import)
 *   4. Write blob to CAS using sendfile(2)/copyfile(2) or mmap+write fallback
 *   5. Emit aurekai.cas.fast.v1 JSON result
 *
 * This is the C-native fast path for CAS import. The JS layer delegates to
 * this binary when it detects native/bin/akai-cas-fast exists.
 *
 * Usage:
 *   akai-cas-fast <source-file> [--cas-home <path>]
 *   CAS_HOME=<path> akai-cas-fast <source-file>
 *
 * Exit: 0=ok, 1=error
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <fcntl.h>
#include <unistd.h>
#include <time.h>
#include <errno.h>

#ifdef __APPLE__
#  include <CommonCrypto/CommonDigest.h>
#  include <copyfile.h>
#  define SHA256_CTX          CC_SHA256_CTX
#  define SHA256_Init(c)      CC_SHA256_Init(c)
#  define SHA256_Update(c,d,l) CC_SHA256_Update(c,d,(unsigned long)(l))
#  define SHA256_Final(d,c)   CC_SHA256_Final(d,c)
#  define SHA256_DIGEST_LENGTH CC_SHA256_DIGEST_LENGTH
#  define HAS_COPYFILE 1
#else
#  include <openssl/sha.h>
#  ifdef __linux__
#    include <sys/sendfile.h>
#    define HAS_SENDFILE 1
#  endif
#endif

static double now_ms(void) {
  struct timeval tv; gettimeofday(&tv, NULL);
  return (double)tv.tv_sec * 1000.0 + (double)tv.tv_usec / 1000.0;
}

static void iso_now(char buf[32]) {
  time_t t = time(NULL);
  struct tm *tm = gmtime(&t);
  strftime(buf, 32, "%Y-%m-%dT%H:%M:%SZ", tm);
}

/* Compute SHA-256 of file via mmap. Returns 0 on success. */
static int sha256_file(const char *path, size_t file_size, const uint8_t *data, char hex_out[65]) {
  uint8_t digest[SHA256_DIGEST_LENGTH];
  SHA256_CTX ctx;
  SHA256_Init(&ctx);
  size_t chunk = 65536;
  for (size_t off = 0; off < file_size; off += chunk) {
    size_t n = file_size - off < chunk ? file_size - off : chunk;
    SHA256_Update(&ctx, data + off, n);
  }
  SHA256_Final(digest, &ctx);
  for (int i = 0; i < SHA256_DIGEST_LENGTH; i++) snprintf(hex_out + i*2, 3, "%02x", digest[i]);
  hex_out[64] = '\0';
  (void)path;
  return 0;
}

/* mkdir -p equivalent (simple, no error handling for already-exists). */
static int mkdirp(const char *path) {
  char tmp[4096];
  snprintf(tmp, sizeof(tmp), "%s", path);
  for (char *p = tmp + 1; *p; p++) {
    if (*p == '/') {
      *p = '\0';
      mkdir(tmp, 0755);
      *p = '/';
    }
  }
  return mkdir(tmp, 0755);
}

/* Copy bytes from src_fd to dst_fd using mmap+write fallback. */
static int copy_via_mmap(int src_fd, int dst_fd, size_t size) {
  if (size == 0) return 0;
  void *src = mmap(NULL, size, PROT_READ, MAP_PRIVATE | MAP_FILE, src_fd, 0);
  if (src == MAP_FAILED) return -1;
  size_t off = 0;
  while (off < size) {
    ssize_t n = write(dst_fd, (char*)src + off, size - off);
    if (n <= 0) { munmap(src, size); return -1; }
    off += (size_t)n;
  }
  munmap(src, size);
  return 0;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "Usage: akai-cas-fast <source-file> [--cas-home <path>]\n");
    return 1;
  }

  const char *src_path = argv[1];
  const char *cas_home = getenv("AKAI_CAS_HOME");
  char default_home[4096];

  for (int i = 2; i < argc - 1; i++) {
    if (strcmp(argv[i], "--cas-home") == 0) cas_home = argv[i+1];
  }
  if (!cas_home) {
    const char *home = getenv("HOME");
    snprintf(default_home, sizeof(default_home), "%s/.aurekai/cas", home ? home : "/tmp");
    cas_home = default_home;
  }

  double t0 = now_ms();

  /* Open and mmap source. */
  int src_fd = open(src_path, O_RDONLY);
  if (src_fd < 0) { perror("open source"); return 1; }
  struct stat st;
  fstat(src_fd, &st);
  size_t file_size = (size_t)st.st_size;

  uint8_t *src_data = NULL;
  if (file_size > 0) {
    src_data = mmap(NULL, file_size, PROT_READ, MAP_PRIVATE | MAP_FILE, src_fd, 0);
    if (src_data == MAP_FAILED) { perror("mmap"); close(src_fd); return 1; }
#ifdef MADV_SEQUENTIAL
    madvise(src_data, file_size, MADV_SEQUENTIAL);
#endif
  }

  /* Compute SHA-256 content address. */
  double t1 = now_ms();
  char sha256_hex[65];
  if (file_size > 0) {
    sha256_file(src_path, file_size, src_data, sha256_hex);
  } else {
    strcpy(sha256_hex, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  }
  double t2 = now_ms();

  /* Build CAS blob path: <cas_home>/blobs/<sha256_hex[0:2]>/<sha256_hex> */
  char blob_dir[4096], blob_path[4200];
  snprintf(blob_dir, sizeof(blob_dir), "%s/blobs/%c%c", cas_home, sha256_hex[0], sha256_hex[1]);
  snprintf(blob_path, sizeof(blob_path), "%s/%s", blob_dir, sha256_hex);

  int already_exists = (access(blob_path, F_OK) == 0);
  int imported = 0;

  if (!already_exists) {
    mkdirp(blob_dir);
    int dst_fd = open(blob_path, O_WRONLY | O_CREAT | O_EXCL, 0644);
    if (dst_fd >= 0) {
      int ok = 0;
#ifdef HAS_COPYFILE
      /* macOS: use mmap+write path (copyfile API is for paths, not fds). */
      lseek(src_fd, 0, SEEK_SET);
      ok = copy_via_mmap(src_fd, dst_fd, file_size) == 0 ? 1 : 0;
#elif defined(HAS_SENDFILE)
      lseek(src_fd, 0, SEEK_SET);
      ssize_t sent = sendfile(dst_fd, src_fd, NULL, file_size);
      ok = (sent == (ssize_t)file_size);
#else
      ok = copy_via_mmap(src_fd, dst_fd, file_size) == 0;
#endif
      close(dst_fd);
      if (!ok) {
        unlink(blob_path);
        fprintf(stderr, "akai-cas-fast: write failed\n");
        if (src_data) munmap(src_data, file_size);
        close(src_fd);
        return 1;
      }
      imported = 1;
    }
    /* If EEXIST: race with another writer — treat as already_exists. */
  }

  if (src_data) munmap(src_data, file_size);
  close(src_fd);

  double t3 = now_ms();
  char ts[32]; iso_now(ts);

  printf("{\n");
  printf("  \"schema_version\": \"aurekai.cas.fast.v1\",\n");
  printf("  \"source\": \"%s\",\n", src_path);
  printf("  \"content_address\": \"sha256:%s\",\n", sha256_hex);
  printf("  \"size_bytes\": %zu,\n", file_size);
  printf("  \"already_existed\": %s,\n", already_exists ? "true" : "false");
  printf("  \"imported\": %s,\n", imported ? "true" : "false");
  printf("  \"hash_ms\": %.3f,\n", t2 - t1);
  printf("  \"total_ms\": %.3f,\n", t3 - t0);
  printf("  \"throughput_mb_s\": %.2f,\n",
         (t3 - t0) > 0 ? ((double)file_size / (1024.0*1024.0)) / ((t3-t0)/1000.0) : 0.0);
  printf("  \"blob_path\": \"%s\",\n", blob_path);
  printf("  \"generated_at\": \"%s\"\n", ts);
  printf("}\n");

  return 0;
}
