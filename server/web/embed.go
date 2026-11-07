// Package web holds the files built into the server binary: the editor
// (dist/, copied from frontend/dist by the Docker build), the About page and
// the demo account's sample notes (demo/).
package web

import "embed"

//go:embed all:dist
var Dist embed.FS

//go:embed landing.html icon.svg
var Landing embed.FS

//go:embed all:demo
var Demo embed.FS
