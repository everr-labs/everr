// Command everr-healthcheck probes the collector's health_check extension. The
// collector image has no shell or wget, so container healthchecks run this.
package main

import (
	"fmt"
	"net/http"
	"os"
	"time"
)

const defaultURL = "http://127.0.0.1:13133/"

func main() {
	url := defaultURL
	if len(os.Args) > 1 {
		url = os.Args[1]
	}
	if err := check(url); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func check(url string) error {
	client := http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("%s returned %s", url, resp.Status)
	}
	return nil
}
