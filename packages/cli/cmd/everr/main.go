package main

import (
	"os"

	"github.com/everr-labs/everr/packages/cli/internal/cli"
)

func main() {
	os.Exit(cli.Main(os.Args[1:]))
}
