UNAME_S ?= $(shell uname -s)
UNAME_M ?= $(shell uname -m)
REPO_ROOT := $(shell git rev-parse --show-toplevel)

CHDB_RELEASE_VERSION ?= v4.0.2
CHDB_LIB_ASSET_NAME ?= linux-x86_64-libchdb.tar.gz
CHDB_LIB_ARCHIVE_SHA256 ?= fb722f81c61c1fb2eb3511f17a5adc85b231f6bbc2415de6aea3ad9b73bb272e
CHDB_CACHE_DIR ?= $(REPO_ROOT)/target/chdb
CHDB_EXTRACT_DIR ?= $(CHDB_CACHE_DIR)/$(CHDB_RELEASE_VERSION)-linux-x86_64
CHDB_TEST_LIB := $(CHDB_EXTRACT_DIR)/libchdb.so

ifeq ($(UNAME_S),Linux)
ifeq ($(UNAME_M),x86_64)
TEST_PREP = ./ensure-libchdb.sh "$(CHDB_RELEASE_VERSION)" "$(CHDB_LIB_ASSET_NAME)" "$(CHDB_LIB_ARCHIVE_SHA256)" "$(CHDB_CACHE_DIR)" "$(CHDB_EXTRACT_DIR)"
TEST_ENV = CHDB_LIB_PATH="$(CHDB_TEST_LIB)"
endif
endif

include ../../Makefile.Common
