include ../../Makefile.Common
UNAME_S ?= $(shell uname -s)
UNAME_M ?= $(shell uname -m)
REPO_ROOT := $(shell git rev-parse --show-toplevel)

CHDB_RELEASE_VERSION ?= v26.5.0
CHDB_CACHE_DIR ?= $(REPO_ROOT)/target/chdb

ifeq ($(UNAME_S),Darwin)
ifeq ($(UNAME_M),arm64)
CHDB_LIB_ASSET_NAME ?= macos-arm64-libchdb.tar.gz
CHDB_LIB_ARCHIVE_SHA256 ?= 86a77d5aa775902740d312153eddfbdc641b8fd5a2e028ddfd18d002ade9ec38
CHDB_EXTRACT_DIR ?= $(CHDB_CACHE_DIR)/$(CHDB_RELEASE_VERSION)-extract
endif
endif

ifeq ($(UNAME_S),Linux)
ifeq ($(UNAME_M),x86_64)
CHDB_LIB_ASSET_NAME ?= linux-x86_64-libchdb.tar.gz
CHDB_LIB_ARCHIVE_SHA256 ?= 8dc5155d80b20a27d3e7322bb49ce003807ebd2b8cbd43896c829d16d24b0cdf
CHDB_EXTRACT_DIR ?= $(CHDB_CACHE_DIR)/$(CHDB_RELEASE_VERSION)-linux-x86_64
endif
endif

ifneq ($(strip $(CHDB_LIB_ASSET_NAME)),)
CHDB_TEST_LIB := $(CHDB_EXTRACT_DIR)/libchdb.so
TEST_PREP = ../../internal/localgateway/chdb/ensure-libchdb.sh "$(CHDB_RELEASE_VERSION)" "$(CHDB_LIB_ASSET_NAME)" "$(CHDB_LIB_ARCHIVE_SHA256)" "$(CHDB_CACHE_DIR)" "$(CHDB_EXTRACT_DIR)"
TEST_ENV = CHDB_LIB_PATH="$(CHDB_TEST_LIB)"
endif
