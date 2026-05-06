# Native C Operators — Aurekai
# macOS (ARM64 + x86_64) / Linux (x86_64 + ARM64)
#
# Targets:
#   make all          — build all native operators
#   make clean        — remove binaries
#   make install      — copy to native/bin/ (already the output dir)
#   make check        — build and run smoke tests

CC      ?= cc
CFLAGS  := -O3 -march=native -Wall -Wextra -Wpedantic -std=c11 \
           -D_FILE_OFFSET_BITS=64
LDFLAGS :=

# macOS: link against CommonCrypto (no extra flags needed; it's in libSystem).
# Linux: link against libssl.
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
  # CommonCrypto is built into libSystem on macOS — no -l flag needed.
  CRYPTO_LDFLAGS :=
else
  CRYPTO_LDFLAGS := -lssl -lcrypto
endif

OUTDIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))bin

BINS := \
  $(OUTDIR)/akai-chunk \
  $(OUTDIR)/akai-mmap-bench \
  $(OUTDIR)/akai-proof-fast \
  $(OUTDIR)/akai-cas-fast \
  $(OUTDIR)/akai-block-inspect

.PHONY: all clean check install

all: $(OUTDIR) $(BINS)

$(OUTDIR):
	mkdir -p $@

$(OUTDIR)/akai-chunk: akai-chunk.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS) $(CRYPTO_LDFLAGS)

$(OUTDIR)/akai-mmap-bench: akai-mmap-bench.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS) $(CRYPTO_LDFLAGS)

$(OUTDIR)/akai-proof-fast: akai-proof-fast.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS) $(CRYPTO_LDFLAGS)

$(OUTDIR)/akai-cas-fast: akai-cas-fast.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS) $(CRYPTO_LDFLAGS)

$(OUTDIR)/akai-block-inspect: akai-block-inspect.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS) $(CRYPTO_LDFLAGS) -lm

clean:
	rm -rf $(OUTDIR)

# Smoke tests: build all, then run minimal self-checks.
check: all
	@echo "=== smoke: akai-chunk ==="
	echo "hello world" > /tmp/akai-chunk-test.bin
	$(OUTDIR)/akai-chunk /tmp/akai-chunk-test.bin | grep -q '"schema_version":"aurekai.chunk.graph.v1"' && echo "PASS chunk"
	@echo "=== smoke: akai-mmap-bench ==="
	$(OUTDIR)/akai-mmap-bench /tmp/akai-chunk-test.bin --runs 1 | grep -q '"schema_version": "aurekai.mmap.bench.v1"' && echo "PASS mmap-bench"
	@echo "=== smoke: akai-proof-fast ==="
	echo '{"proof_chain":[{"hash":"sha256:abc123"},{"hash":"sha256:def456"}]}' > /tmp/akai-proof-test.json
	$(OUTDIR)/akai-proof-fast /tmp/akai-proof-test.json | grep -q '"chain_valid": true' && echo "PASS proof-fast"
	@echo "=== smoke: akai-cas-fast ==="
	$(OUTDIR)/akai-cas-fast /tmp/akai-chunk-test.bin | grep -q '"schema_version": "aurekai.cas.fast.v1"' && echo "PASS cas-fast"
	@echo "=== smoke: akai-block-inspect ==="
	$(OUTDIR)/akai-block-inspect /tmp/akai-chunk-test.bin --tensor q_proj | grep -q '"schema_version": "aurekai.block.inspect.v1"' && echo "PASS block-inspect"
	@echo "=== all native smoke tests passed ==="
