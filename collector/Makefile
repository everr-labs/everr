include ./Makefile.Common

EVERR_BUILD_TARGET ?= cloud
MANIFEST_ADDITIONS = $(if $(filter cloud,$(EVERR_BUILD_TARGET)),config/manifest.cloud.yaml,)
MANIFEST ?= config/manifest.$(EVERR_BUILD_TARGET).generated.yaml
OUT ?= ./build/$(EVERR_BUILD_TARGET)
DEBUG_COMPILATION ?= false
CUSTOM_COL_DIR ?= $(SRC_ROOT)/collector/build/$(EVERR_BUILD_TARGET)
OS := $(shell uname | tr '[:upper:]' '[:lower:]')
ARCH := $(shell uname -m)

# Arguments for getting directories & executing commands against them
PKG_DIRS = $(shell find ./* -not -path "./build/*" -not -path "./build-local/*" -not -path "./tmp/*" -type f -name "go.mod" -exec dirname {} \; | sort | grep -E '^./')
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
	@set -e; \
	  trap 'rm -f "$(MANIFEST)"' EXIT; \
	  if [ -n "$(MANIFEST_ADDITIONS)" ]; then \
	    (cd internal/tools && go run ./cmd/manifestgen ../../config/manifest.yaml ../../$(MANIFEST_ADDITIONS) ../../$(MANIFEST) '$(OUT)' '$(DEBUG_COMPILATION)'); \
	  else \
	    (cd internal/tools && go run ./cmd/manifestgen ../../config/manifest.yaml /dev/null ../../$(MANIFEST) '$(OUT)' '$(DEBUG_COMPILATION)'); \
	  fi; \
	  mkdir -p $(OUT); \
	  GOOS=$(OS) GOARCH=$(ARCH) CGO_ENABLED=0 $(OCB) --config $(MANIFEST)

.PHONY: build-debug
build-debug: DEBUG_COMPILATION = true
build-debug: OUT = ./build/$(EVERR_BUILD_TARGET)-debug
build-debug: MANIFEST = config/manifest.$(EVERR_BUILD_TARGET).debug.generated.yaml
build-debug: build

.PHONY: build-local
build-local:
	mkdir -p build-local
	rm -f build-local/*.go build-local/go.mod build-local/go.sum
	cd cmd/everr-local-collector && GOOS=$(OS) GOARCH=$(ARCH) CGO_ENABLED=0 go build -trimpath -o ../../build-local/everr-local-collector .

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
	docker build . --build-arg EVERR_BUILD_TARGET=$(EVERR_BUILD_TARGET) -t everr-labs/everr-collector:localdev

.PHONY: dockerrun
dockerrun: dockerbuild
	docker run -v ./config.yml:/etc/everr-collector/config.yml -t everr-labs/everr-collector:localdev

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
