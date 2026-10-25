include ../../Makefile.Common
UNAME_S ?= $(shell uname -s)
UNAME_M ?= $(shell uname -m)
REPO_ROOT := $(shell git rev-parse --show-toplevel)

CHDB_RELEASE_VERSION ?= v26.7.3
CHDB_CACHE_DIR ?= $(REPO_ROOT)/target/chdb

ifeq ($(UNAME_S),Darwin)
ifeq ($(UNAME_M),arm64)
CHDB_LIB_ASSET_NAME ?= macos-arm64-libchdb.tar.gz
CHDB_LIB_ARCHIVE_SHA256 ?= 5640e50dccf711bf3dd5551333d08e43f433edf7bd94b2289f36c2539e627762
CHDB_EXTRACT_DIR ?= $(CHDB_CACHE_DIR)/$(CHDB_RELEASE_VERSION)-extract
endif
endif

ifeq ($(UNAME_S),Linux)
ifeq ($(UNAME_M),x86_64)
CHDB_LIB_ASSET_NAME ?= linux-x86_64-libchdb.tar.gz
CHDB_LIB_ARCHIVE_SHA256 ?= bc33260c32acf78eade2ac41a9115f38e00404651fa42e3bb4c419e4f011c031
CHDB_EXTRACT_DIR ?= $(CHDB_CACHE_DIR)/$(CHDB_RELEASE_VERSION)-linux-x86_64
endif
ifeq ($(UNAME_M),aarch64)
CHDB_LIB_ASSET_NAME ?= linux-aarch64-libchdb.tar.gz
CHDB_LIB_ARCHIVE_SHA256 ?= d153adad1ff39b2e3caf0417f09d8bd9edd41939c7c67a3c4978a61e73fb9227
CHDB_EXTRACT_DIR ?= $(CHDB_CACHE_DIR)/$(CHDB_RELEASE_VERSION)-linux-aarch64
endif
endif

ifneq ($(strip $(CHDB_LIB_ASSET_NAME)),)
CHDB_TEST_LIB := $(CHDB_EXTRACT_DIR)/libchdb.so
TEST_PREP = ../../internal/localgateway/chdb/ensure-libchdb.sh "$(CHDB_RELEASE_VERSION)" "$(CHDB_LIB_ASSET_NAME)" "$(CHDB_LIB_ARCHIVE_SHA256)" "$(CHDB_CACHE_DIR)" "$(CHDB_EXTRACT_DIR)"
TEST_ENV = CHDB_LIB_PATH="$(CHDB_TEST_LIB)"
endif
