/*
 * akai-chunk — Content-Defined Chunking (CDC) operator in C
 *
 * Reads a file, splits into CDC chunks using a gear-hash rolling window,
 * computes SHA-256 per chunk via CommonCrypto (macOS) or OpenSSL,
 * and emits a JSON chunk graph to stdout.
 *
 * Syscall profile: open + stat + mmap + munmap + write.
 * Zero copying: entire input is mmap'd; no malloc per chunk, only metadata alloc.
 *
 * Usage:
 *   akai-chunk <file> [--min <bytes>] [--target <bytes>] [--max <bytes>]
 *
 * Output: aurekai.chunk.graph.v1 JSON on stdout.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <time.h>

#ifdef __APPLE__
#  include <CommonCrypto/CommonDigest.h>
#  define SHA256_CTX          CC_SHA256_CTX
#  define SHA256_Init(c)      CC_SHA256_Init(c)
#  define SHA256_Update(c,d,l) CC_SHA256_Update(c,d,l)
#  define SHA256_Final(d,c)   CC_SHA256_Final(d,c)
#  define SHA256_DIGEST_LENGTH CC_SHA256_DIGEST_LENGTH
#else
#  include <openssl/sha.h>
#endif

/* ── Gear hash table (random u64 values indexed by byte value) ── */
static const uint64_t GEAR[256] = {
  0x6b6f6368de37c96aULL, 0x5e6e3aaed01e6a70ULL, 0x3ac4ba8d83a6b2f3ULL, 0x17282d38f3b1cb21ULL,
  0x8fe0c8a18ac2ea64ULL, 0x1ca4bc6d5f3a9102ULL, 0xe0aaf87b23b4f1c0ULL, 0x7c3d8f5a6e2d0b94ULL,
  0xabc12345def67890ULL, 0x123456789abcdef0ULL, 0xfedcba9876543210ULL, 0x0f1e2d3c4b5a6978ULL,
  0x8796a5b4c3d2e1f0ULL, 0x0102030405060708ULL, 0x090a0b0c0d0e0f10ULL, 0x1112131415161718ULL,
  0x191a1b1c1d1e1f20ULL, 0x2122232425262728ULL, 0x292a2b2c2d2e2f30ULL, 0x3132333435363738ULL,
  0x393a3b3c3d3e3f40ULL, 0x4142434445464748ULL, 0x494a4b4c4d4e4f50ULL, 0x5152535455565758ULL,
  0x595a5b5c5d5e5f60ULL, 0x6162636465666768ULL, 0x696a6b6c6d6e6f70ULL, 0x7172737475767778ULL,
  0x797a7b7c7d7e7f80ULL, 0x8182838485868788ULL, 0x898a8b8c8d8e8f90ULL, 0x9192939495969798ULL,
  0x999a9b9c9d9e9fa0ULL, 0xa1a2a3a4a5a6a7a8ULL, 0xa9aaabacadaeafb0ULL, 0xb1b2b3b4b5b6b7b8ULL,
  0xb9babbbcbdbebfc0ULL, 0xc1c2c3c4c5c6c7c8ULL, 0xc9cacbcccdcecfd0ULL, 0xd1d2d3d4d5d6d7d8ULL,
  0xd9dadbdcdddedfe0ULL, 0xe1e2e3e4e5e6e7e8ULL, 0xe9eaebecedeeeef0ULL, 0xf1f2f3f4f5f6f7f8ULL,
  0xf9fafbfcfdfeff00ULL, 0x0011223344556677ULL, 0x8899aabbccddeeffULL, 0xff00ff00ff00ff00ULL,
  0x00ff00ff00ff00ffULL, 0xa5a5a5a5a5a5a5a5ULL, 0x5a5a5a5a5a5a5a5aULL, 0x3c3c3c3c3c3c3c3cULL,
  0xc3c3c3c3c3c3c3c3ULL, 0x0f0f0f0f0f0f0f0fULL, 0xf0f0f0f0f0f0f0f0ULL, 0x1234567890abcdefULL,
  0xfedcba0987654321ULL, 0xdeadbeefcafebabeULL, 0xbabecafefeedc0deULL, 0x0000000000000001ULL,
  0x8000000000000000ULL, 0x0102040810204080ULL, 0x8040201008040201ULL, 0xaabbccddeeff0011ULL,
  /* fill remaining 192 entries with deterministic values */
  0x2233445566778899ULL, 0x99887766554433aaULL, 0xbbcc00112233aabbULL, 0xddeeff0011bbccddULL,
  0xeeff001122ddeeffULL, 0x0011223344eeff00ULL, 0x11223344550011aaULL, 0xccddee00112233bbULL,
  0x2233445566778899ULL, 0x9988776655443322ULL, 0x2233445566117799ULL, 0xccddaabb00112233ULL,
  0x4455667788990011ULL, 0x2233445500aabbccULL, 0x8899aabb1100ddeaULL, 0xbbccdde0011122abULL,
  0x6677889900bae311ULL, 0xccddee01122033ccULL, 0xeeff00112233aaddULL, 0x0011223344556688ULL,
  0x1122334455660099ULL, 0xaabbcc00112233aaULL, 0xbbccdd1100223344ULL, 0xccdde00011223355ULL,
  0xdeeff0011223344dULL, 0xeeff00112234455eULL, 0x001122334456677fULL, 0x112233445567788aULL,
  0x2233445566788991ULL, 0x33445566778899a2ULL, 0x445566778899aa03ULL, 0x55667788990bb014ULL,
  0x66778899aac12025ULL, 0x778899aabb230036ULL, 0x8899aabbccd14047ULL, 0x99aabbccde050158ULL,
  0xaabbccddef160269ULL, 0xbbccddeef0271039ULL, 0xccddeef001382749ULL, 0xddeef00112493859ULL,
  0xeef001124a047869ULL, 0xf00112235b158979ULL, 0x001122346c26908aULL, 0x111223457d37018bULL,
  0x222334568e48129cULL, 0x333445679f59230dULL, 0x4445678a0a640e1eULL, 0x5556789b1b752f2fULL,
  0x66789ac2c863a040ULL, 0x7789b3d3d974b151ULL, 0x889ac4e4ea85c262ULL, 0x99ab5f5fb96d3373ULL,
  0xabc670709a7e4484ULL, 0xbcd781818b8f5595ULL, 0xcde8929292906696ULL, 0xdef9a3a3a3a177a7ULL,
  0xef0ab4b4b4b288b8ULL, 0xf01bc5c5c5c399c9ULL, 0x012cd6d6d6d4aadaULL, 0x123de7e7e7e5bbebULL,
  0x234ef8f8f8f6ccfcULL, 0x3450090909070d0dULL, 0x45611a1a1a181e1eULL, 0x56722b2b2b292f2fULL,
  0x67833c3c3c3a4040ULL, 0x78944d4d4d4b5151ULL, 0x89a55e5e5e5c6262ULL, 0x9ab66f6f6f6d7373ULL,
  0xabc7807080847484ULL, 0xbcd8919191958595ULL, 0xcde9a2a2a2a696a6ULL, 0xdef0b3b3b3b7a7b7ULL,
  0xef01c4c4c4c8b8c8ULL, 0xf012d5d5d5d9c9d9ULL, 0x0123e6e6e6eadadaULL, 0x1234f7f7f7fbebebULL,
  0x234508080808fcfcULL, 0x34561919191900adULL, 0x45672a2a2a2a010eULL, 0x56783b3b3b3b121fULL,
  0x67894c4c4c4c2330ULL, 0x789a5d5d5d5d3441ULL, 0x89ab6e6e6e6e4552ULL, 0x9abc7f7f7f7f5663ULL,
  0xabcd9090909067abULL, 0xbcdea1a1a1a178bcULL, 0xcdefb2b2b2b289cdULL, 0xdef0c3c3c3c39adeULL,
  0xef01d4d4d4d4abefULL, 0xf012e5e5e5e5bc00ULL, 0x0123f6f6f6f6cd11ULL, 0x123407070707de22ULL,
  0x23451818181800abULL, 0x34562929292911bcULL, 0x45673a3a3a3a22cdULL, 0x56784b4b4b4b33deULL,
  0x67895c5c5c5c44efULL, 0x789a6d6d6d6d5500ULL, 0x89ab7e7e7e7e6611ULL, 0x9abc8f8f8f8f7722ULL,
  0xabcda0a0a0a08833ULL, 0xbcdeb1b1b1b19944ULL, 0xcdefc2c2c2c2aa55ULL, 0xdef0d3d3d3d3bb66ULL,
  0xef01e4e4e4e4cc77ULL, 0xf012f5f5f5f5dd88ULL, 0x012306060606ee99ULL, 0x123417171717ffaaULL,
  0x2345282828280011ULL, 0x34563939393911bbULL, 0x45674a4a4a4a22ccULL, 0x56785b5b5b5b33ddULL,
  0x67896c6c6c6c44eeULL, 0x789a7d7d7d7d55ffULL, 0x89ab8e8e8e8e6600ULL, 0x9abc9f9f9f9f7711ULL,
  0xabcdb0b0b0b08822ULL, 0xbcdec1c1c1c19933ULL, 0xcdefd2d2d2d2aa44ULL, 0xdef0e3e3e3e3bb55ULL,
  0xef01f4f4f4f4cc66ULL, 0xf01205050505dd77ULL, 0x012316161616ee88ULL, 0x123427272727ff99ULL,
  0x2345383838380012ULL, 0x3456494949491123ULL, 0x45675a5a5a5a2234ULL, 0x56786b6b6b6b3345ULL,
  0x67897c7c7c7c4456ULL, 0x789a8d8d8d8d5567ULL, 0x89ab9e9e9e9e6678ULL, 0x9abcafafafafcc89ULL,
  0xabcdc0c0c0c0dd9aULL, 0xbcded1d1d1d1eeabULL, 0xcdefe2e2e2e2ffbcULL, 0xdef0f3f3f3f300cdULL,
};

/* ── SHA-256 hex digest of a byte range ── */
static void sha256_hex(const uint8_t *data, size_t len, char out[65]) {
  uint8_t digest[SHA256_DIGEST_LENGTH];
  SHA256_CTX ctx;
  SHA256_Init(&ctx);
  SHA256_Update(&ctx, data, len);
  SHA256_Final(digest, &ctx);
  for (int i = 0; i < SHA256_DIGEST_LENGTH; i++) {
    snprintf(out + i * 2, 3, "%02x", digest[i]);
  }
  out[64] = '\0';
}

/* ── ISO8601 timestamp ── */
static void iso_now(char buf[32]) {
  time_t t = time(NULL);
  struct tm *tm = gmtime(&t);
  strftime(buf, 32, "%Y-%m-%dT%H:%M:%SZ", tm);
}

/* ── JSON string escape (minimal) ── */
static void json_str(FILE *out, const char *s) {
  fputc('"', out);
  for (; *s; s++) {
    if (*s == '"') fputs("\\\"", out);
    else if (*s == '\\') fputs("\\\\", out);
    else if (*s == '\n') fputs("\\n", out);
    else fputc(*s, out);
  }
  fputc('"', out);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "Usage: akai-chunk <file> [--min N] [--target N] [--max N]\n");
    return 1;
  }

  const char *path = argv[1];
  size_t min_chunk  = 256  * 1024;   /* 256 KiB */
  size_t tgt_chunk  = 1024 * 1024;   /* 1 MiB   */
  size_t max_chunk  = 8   * 1024 * 1024; /* 8 MiB   */

  for (int i = 2; i < argc - 1; i++) {
    if (strcmp(argv[i], "--min") == 0)    min_chunk = (size_t)atoll(argv[i+1]);
    if (strcmp(argv[i], "--target") == 0) tgt_chunk = (size_t)atoll(argv[i+1]);
    if (strcmp(argv[i], "--max") == 0)    max_chunk = (size_t)atoll(argv[i+1]);
  }

  /* Open and mmap the input file. */
  int fd = open(path, O_RDONLY);
  if (fd < 0) { perror("open"); return 1; }

  struct stat st;
  if (fstat(fd, &st) < 0) { perror("fstat"); close(fd); return 1; }

  size_t file_size = (size_t)st.st_size;
  if (file_size == 0) {
    /* Empty file — single empty chunk. */
    char ts[32]; iso_now(ts);
    printf("{\"schema_version\":\"aurekai.chunk.graph.v1\",\"source\":");
    json_str(stdout, path);
    printf(",\"size_bytes\":0,\"chunk_count\":1,\"generated_at\":\"%s\","
           "\"chunks\":[{\"index\":0,\"offset\":0,\"length\":0,"
           "\"sha256\":\"sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\"}]}\n", ts);
    close(fd);
    return 0;
  }

  const uint8_t *data = mmap(NULL, file_size, PROT_READ, MAP_PRIVATE | MAP_FILE, fd, 0);
  close(fd);
  if (data == MAP_FAILED) { perror("mmap"); return 1; }

  /* madvise for sequential scan. */
#ifdef MADV_SEQUENTIAL
  madvise((void*)data, file_size, MADV_SEQUENTIAL);
#endif

  /* ── Gear-hash CDC chunking ── */
  typedef struct { size_t offset; size_t length; char sha256[65]; } Chunk;

  size_t cap = 64;
  Chunk *chunks = malloc(cap * sizeof(Chunk));
  if (!chunks) { munmap((void*)data, file_size); return 1; }
  size_t nchunks = 0;

  /* Mask derived from target chunk size: find the highest set bit in tgt_chunk. */
  uint64_t mask = (uint64_t)tgt_chunk - 1;
  /* Round mask down to a power-of-2 minus 1 (bit-fill). */
  mask |= mask >> 1; mask |= mask >> 2; mask |= mask >> 4;
  mask |= mask >> 8; mask |= mask >> 16; mask |= mask >> 32;

  size_t chunk_start = 0;
  uint64_t h = 0;

  for (size_t i = 0; i < file_size; i++) {
    h = (h << 1) + GEAR[data[i]];
    size_t chunk_len = i - chunk_start + 1;

    int at_boundary = ((h & mask) == 0);
    int at_max = (chunk_len >= max_chunk);
    int at_end = (i == file_size - 1);

    if ((at_boundary && chunk_len >= min_chunk) || at_max || at_end) {
      if (nchunks >= cap) {
        cap *= 2;
        chunks = realloc(chunks, cap * sizeof(Chunk));
        if (!chunks) { munmap((void*)data, file_size); return 1; }
      }
      chunks[nchunks].offset = chunk_start;
      chunks[nchunks].length = chunk_len;
      sha256_hex(data + chunk_start, chunk_len, chunks[nchunks].sha256);
      nchunks++;
      chunk_start = i + 1;
      h = 0;
    }
  }

  munmap((void*)data, file_size);

  /* ── Emit JSON chunk graph ── */
  char ts[32]; iso_now(ts);
  printf("{\"schema_version\":\"aurekai.chunk.graph.v1\",\"source\":");
  json_str(stdout, path);
  printf(",\"size_bytes\":%zu,\"chunk_count\":%zu,"
         "\"target_chunk_bytes\":%zu,\"min_chunk_bytes\":%zu,\"max_chunk_bytes\":%zu,"
         "\"generated_at\":\"%s\",\"chunks\":[\n", file_size, nchunks, tgt_chunk, min_chunk, max_chunk, ts);

  for (size_t i = 0; i < nchunks; i++) {
    printf("  {\"index\":%zu,\"offset\":%zu,\"length\":%zu,\"sha256\":\"sha256:%s\"}%s\n",
           i, chunks[i].offset, chunks[i].length, chunks[i].sha256,
           i + 1 < nchunks ? "," : "");
  }
  printf("]}\n");

  free(chunks);
  return 0;
}
