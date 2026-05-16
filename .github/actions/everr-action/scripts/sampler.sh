#!/usr/bin/env bash
set -euo pipefail

samples_path="$1"
workspace_path="$2"
interval="$3"

declare -a prev_cpu_logical_numbers=()
declare -a prev_cpu_totals=()
declare -a prev_cpu_idles=()
declare -a current_cpu_logical_numbers=()
declare -a current_cpu_totals=()
declare -a current_cpu_idles=()

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

read_cpu_counters() {
  current_cpu_logical_numbers=()
  current_cpu_totals=()
  current_cpu_idles=()

  while read -r logical total idle; do
    current_cpu_logical_numbers+=("$logical")
    current_cpu_totals+=("$total")
    current_cpu_idles+=("$idle")
  done < <(
    awk '
      /^cpu[0-9]+ / {
        logical = substr($1, 4)
        idle = $5 + $6
        total = 0
        for (i = 2; i <= NF; i++) {
          total += $i
        }
        print logical, total, idle
      }
    ' /proc/stat
  )
}

copy_current_cpu_to_prev() {
  prev_cpu_logical_numbers=("${current_cpu_logical_numbers[@]}")
  prev_cpu_totals=("${current_cpu_totals[@]}")
  prev_cpu_idles=("${current_cpu_idles[@]}")
}

build_cpu_logical_json() {
  local json="["
  local count="${#current_cpu_logical_numbers[@]}"

  for ((index = 0; index < count; index += 1)); do
    local logical="${current_cpu_logical_numbers[index]}"
    local prev_total="${current_cpu_totals[index]}"
    local prev_idle="${current_cpu_idles[index]}"

    if (( index < ${#prev_cpu_totals[@]} )) && [[ "${prev_cpu_logical_numbers[index]}" == "$logical" ]]; then
      prev_total="${prev_cpu_totals[index]}"
      prev_idle="${prev_cpu_idles[index]}"
    fi

    local utilization
    utilization="$(
      awk \
        -v prev_total="$prev_total" \
        -v prev_idle="$prev_idle" \
        -v current_total="${current_cpu_totals[index]}" \
        -v current_idle="${current_cpu_idles[index]}" '
          BEGIN {
            delta_total = current_total - prev_total
            delta_idle = current_idle - prev_idle
            if (delta_total <= 0) {
              printf "0.000000"
            } else {
              printf "%.6f", ((delta_total - delta_idle) / delta_total)
            }
          }
        '
    )"

    if (( index > 0 )); then
      json+=","
    fi

    json+="{\"logicalNumber\":${logical},\"utilization\":${utilization}}"
  done

  json+="]"
  printf '%s' "$json"
}

read_memory_stats() {
  local mem_total_kb
  local mem_available_kb

  read -r mem_total_kb mem_available_kb < <(
    awk '
      /^MemTotal:/ { total = $2 }
      /^MemAvailable:/ { available = $2 }
      END { print total, available }
    ' /proc/meminfo
  )

  MEMORY_LIMIT_BYTES=$((mem_total_kb * 1024))
  MEMORY_AVAILABLE_BYTES=$((mem_available_kb * 1024))
  MEMORY_USED_BYTES=$(((mem_total_kb - mem_available_kb) * 1024))
  MEMORY_UTILIZATION="$(
    awk -v used="$MEMORY_USED_BYTES" -v limit="$MEMORY_LIMIT_BYTES" '
      BEGIN {
        if (limit <= 0) {
          printf "0.000000"
        } else {
          printf "%.6f", used / limit
        }
      }
    '
  )"
}

read_filesystem_stats() {
  local filesystem_device
  local filesystem_type
  local filesystem_mountpoint
  local filesystem_total_kb
  local filesystem_used_kb
  local filesystem_available_kb

  read -r filesystem_device filesystem_type filesystem_mountpoint filesystem_total_kb filesystem_used_kb filesystem_available_kb < <(
    df -PkT -- "$workspace_path" | awk 'NR == 2 { print $1, $2, $7, $3, $4, $5 }'
  )

  FILESYSTEM_DEVICE="$filesystem_device"
  FILESYSTEM_TYPE="$filesystem_type"
  FILESYSTEM_MOUNTPOINT="$filesystem_mountpoint"
  FILESYSTEM_LIMIT_BYTES=$((filesystem_total_kb * 1024))
  FILESYSTEM_USED_BYTES=$((filesystem_used_kb * 1024))
  FILESYSTEM_FREE_BYTES=$((filesystem_available_kb * 1024))
  FILESYSTEM_UTILIZATION="$(
    awk -v used="$FILESYSTEM_USED_BYTES" -v limit="$FILESYSTEM_LIMIT_BYTES" '
      BEGIN {
        if (limit <= 0) {
          printf "0.000000"
        } else {
          printf "%.6f", used / limit
        }
      }
    '
  )"
}

build_network_interfaces_json() {
  local json="["
  local first=1

  while read -r interface_name receive_bytes transmit_bytes; do
    if (( first == 0 )); then
      json+=","
    fi
    first=0

    json+="{\"name\":\"$(json_escape "$interface_name")\",\"receiveBytes\":${receive_bytes},\"transmitBytes\":${transmit_bytes}}"
  done < <(
    awk -F'[: ]+' '
      NR > 2 {
        interface_name = $2
        if (interface_name == "" || interface_name == "lo") {
          next
        }
        print interface_name, $3, $11
      }
    ' /proc/net/dev
  )

  json+="]"
  printf '%s' "$json"
}

emit_sample() {
  local cpu_logical_json="$1"
  local timestamp
  local network_interfaces_json

  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  read_memory_stats
  read_filesystem_stats
  network_interfaces_json="$(build_network_interfaces_json)"

  printf '{"timestamp":"%s","cpu":{"logical":%s},"memory":{"limitBytes":%s,"usedBytes":%s,"availableBytes":%s,"utilization":%s},"filesystem":{"device":"%s","mountpoint":"%s","type":"%s","limitBytes":%s,"usedBytes":%s,"freeBytes":%s,"utilization":%s},"network":{"interfaces":%s}}\n' \
    "$timestamp" \
    "$cpu_logical_json" \
    "$MEMORY_LIMIT_BYTES" \
    "$MEMORY_USED_BYTES" \
    "$MEMORY_AVAILABLE_BYTES" \
    "$MEMORY_UTILIZATION" \
    "$(json_escape "$FILESYSTEM_DEVICE")" \
    "$(json_escape "$FILESYSTEM_MOUNTPOINT")" \
    "$(json_escape "$FILESYSTEM_TYPE")" \
    "$FILESYSTEM_LIMIT_BYTES" \
    "$FILESYSTEM_USED_BYTES" \
    "$FILESYSTEM_FREE_BYTES" \
    "$FILESYSTEM_UTILIZATION" \
    "$network_interfaces_json" >> "$samples_path"
}

emit_final_sample_and_exit() {
  if read_cpu_counters; then
    emit_sample "$(build_cpu_logical_json)" || true
    copy_current_cpu_to_prev
  fi

  exit 0
}

mkdir -p "$(dirname "$samples_path")"
read_cpu_counters
copy_current_cpu_to_prev
trap emit_final_sample_and_exit TERM INT

while true; do
  sleep "$interval"
  read_cpu_counters
  emit_sample "$(build_cpu_logical_json)"
  copy_current_cpu_to_prev
done
