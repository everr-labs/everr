include ./Makefile.Common

CUSTOM_COL_DIR ?= $(SRC_ROOT)/collector/build
OS := $(shell uname | tr '[:upper:]' '[:lower:]')
ARCH := $(shell uname -m)

# Arguments for getting directories & executing commands against them
PKG_DIRS = $(shell find ./* -not -path "./build/*" -not -path "./tmp/*" -type f -name "go.mod" -exec dirname {} \; | sort | grep -E '^./')
CHECKS = generate fmt-all tidy-all lint-all test-all crosslink

# set ARCH var based on output
ifeq ($(ARCH),x86_64)
	ARCH = amd64
endif
ifeq ($(ARCH),aarch64)
	ARCH = arm64
endif

.PHONY: build
build: $(addprefix $(TOOLS_BIN_DIR)/, builder)
	GOOS=$(OS) GOARCH=$(ARCH) CGO_ENABLED=0 $(OCB) --config config/manifest.yaml

.PHONY: build-debug
build-debug: install-tools
	sed 's/debug_compilation: false/debug_compilation: true/g' config/manifest.yaml > config/manifest-debug.yaml
	$(OCB) --config config/manifest-debug.yaml

.PHONY: run
run: build
	$(CUSTOM_COL_DIR)/everr-collector --config ./config.yml

.PHONY: for-all
for-all:
	@set -e; for dir in $(DIRS); do \
	  (cd "$${dir}" && \
	  	echo "running $${CMD} in $${dir}" && \
	 	$${CMD} ); \
	done

.PHONY: lint-all
lint-all:
	$(MAKE) for-all DIRS="$(PKG_DIRS)" CMD="$(MAKE) lint"

.PHONY: generate
generate:
	$(MAKE) for-all DIRS="$(PKG_DIRS)" CMD="$(MAKE) gen"

.PHONY: test-all
test-all:
	$(MAKE) for-all DIRS="$(PKG_DIRS)" CMD="$(MAKE) test"

.PHONY: dockerbuild
dockerbuild:
	docker build . -t everr-dev/everr-collector:localdev

.PHONY: dockerrun
dockerrun: dockerbuild
	docker run -v ./config.yml:/etc/everr-collector/config.yml -t everr-dev/everr-collector:localdev

.PHONY: tidy-all
tidy-all:
	$(MAKE) tidy
	$(MAKE) for-all DIRS="$(PKG_DIRS)" CMD="$(MAKE) tidy"

.PHONY: fmt-all
fmt-all:
	$(MAKE) for-all DIRS="$(PKG_DIRS)" CMD="$(MAKE) fmt"

# Setting the paralellism to 1 to improve output readability. Reevaluate later as needed for performance
.PHONY: checks
checks: install-tools
	$(MAKE) -j 1 $(CHECKS)
	@if [ -n "$$(git diff --name-only)" ]; then \
		echo "Some files have changed. Please commit them."; \
		exit 1; \
	else \
		echo "completed successfully."; \
	fi

.PHONY: crosslink
crosslink:
	$(CROSSLINK) --root=$(shell pwd) --prune
