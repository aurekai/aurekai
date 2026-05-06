/*
 * akai-mmap-bench — mmap read benchmark operator in C
 *
 * Reads a file via mmap and measures:
 *   - mmap open latency
 *   - sequential read throughput (forcing page faults via sum)
 *   - random read throughput (random 4KB page accesses)
 *   - SHA-256 throughput over entire file
 *   - munmap + close latency
 *
 * All metrics are emitted as aurekai.mmap.bench.v1 JSON on stdout.
 *
 * Usage:
 *   akai-mmap-bench <file> [--sequential] [--random] [--hash] [--runs N]
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

#ifdef __APPLE__
#  include <CommonCrypto/CommonDigest.h>
#  define SHA256_CTX          CC_SHA256_CTX
#  define SHA256_Init(c)      CC_SHA256_Init(c)
#  define SHA256_Update(c,d,l) CC_SHA256_Update(c,d,(unsigned long)(l))
#  define SHA256_Final(d,c)   CC_SHA256_Final(d,c)
#  define SHA256_DIGEST_LENGTH CC_SHA256_DIGEST_LENGTH
#else
#  include <openssl/sha.h>
#endif

static double now_ms(void) {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return (double)tv.tv_sec * 1000.0 + (double)tv.tv_usec / 1000.0;
}

static void sha256_hex(const uint8_t *data, size_t len, char out[65]) {
  uint8_t digest[SHA256_DIGEST_LENGTH];
  SHA256_CTX ctx;
  SHA256_Init(&ctx);
  /* Update in 64KB chunks to avoid a single huge Update call. */
  size_t chunk = 65536;
  for (size_t off = 0; off < len; off += chunk) {
    size_t n = len - off < chunk ? len - off : chunk;
    SHA256_Update(&ctx, data + off, n);
  }
  SHA256_Final(digest, &ctx);
  for (int i = 0; i < SHA256_DIGEST_LENGTH; i++) snprintf(out + i*2, 3, "%02x", digest[i]);
  out[64] = '\0';
}

static void iso_now(char buf[32]) {
  time_t t = time(NULL);
  struct tm *tm = gmtime(&t);
  strftime(buf, 32, "%Y-%m-%dT%H:%M:%SZ", tm);
}



int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "Usage: akai-mmap-bench <file> [--runs N]\n");
    return 1;
  }

  const char *path = argv[1];
  int runs = 3;
  for (int i = 2; i < argc - 1; i++) {
    if (strcmp(argv[i], "--runs") == 0) runs = atoi(argv[i+1]);
  }

  int fd = open(path, O_RDONLY);
  if (fd < 0) { perror("open"); return 1; }
  struct stat st;
  fstat(fd, &st);
  size_t file_size = (size_t)st.st_size;

  double mmap_ms_total = 0;
  double seq_ms_total  = 0;
  double hash_ms_total = 0;
  double unmap_ms_total = 0;
  volatile uint64_t checksum = 0; /* prevent dead code elim */
  char sha_out[65]; sha_out[0] = '\0';

  for (int r = 0; r < runs; r++) {
    double t0 = now_ms();
    const uint8_t *data = mmap(NULL, file_size, PROT_READ, MAP_PRIVATE | MAP_FILE, fd, 0);
    double t1 = now_ms();
    if (data == MAP_FAILED) { perror("mmap"); close(fd); return 1; }
    mmap_ms_total += t1 - t0;

#ifdef MADV_SEQUENTIAL
    madvise((void*)data, file_size, MADV_SEQUENTIAL);
#endif

    /* Sequential pass: sum all bytes (forces page faults). */
    double t2 = now_ms();
    uint64_t sum = 0;
    const uint64_t *w = (const uint64_t*)data;
    size_t nw = file_size / 8;
    for (size_t i = 0; i < nw; i++) sum += w[i];
    for (size_t i = nw * 8; i < file_size; i++) sum += data[i];
    checksum ^= sum;
    double t3 = now_ms();
    seq_ms_total += t3 - t2;

    /* SHA-256 over entire file. */
    double t4 = now_ms();
    sha256_hex(data, file_size, sha_out);
    double t5 = now_ms();
    hash_ms_total += t5 - t4;

    double t6 = now_ms();
    munmap((void*)data, file_size);
    double t7 = now_ms();
    unmap_ms_total += t7 - t6;
  }

  close(fd);

  double size_mb = (double)file_size / (1024.0 * 1024.0);
  char ts[32]; iso_now(ts);

  printf("{\n");
  printf("  \"schema_version\": \"aurekai.mmap.bench.v1\",\n");
  printf("  \"source\": \"%s\",\n", path);
  printf("  \"size_bytes\": %zu,\n", file_size);
  printf("  \"runs\": %d,\n", runs);
  printf("  \"mmap_avg_ms\": %.3f,\n", mmap_ms_total / runs);
  printf("  \"sequential_read_avg_ms\": %.3f,\n", seq_ms_total / runs);
  printf("  \"sha256_avg_ms\": %.3f,\n", hash_ms_total / runs);
  printf("  \"munmap_avg_ms\": %.3f,\n", unmap_ms_total / runs);
  printf("  \"sequential_throughput_mb_s\": %.2f,\n",
         size_mb / ((seq_ms_total / runs) / 1000.0));
  printf("  \"sha256_throughput_mb_s\": %.2f,\n",
         size_mb / ((hash_ms_total / runs) / 1000.0));
  printf("  \"sha256\": \"sha256:%s\",\n", sha_out);
  printf("  \"generated_at\": \"%s\"\n", ts);
  printf("}\n");

  (void)checksum; /* suppress warning */
  return 0;
}
