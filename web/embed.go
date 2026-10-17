// Package web embeds the statically exported Next.js dashboard (web/out).
package web

import (
	"embed"
	"errors"
	"io/fs"
)

//go:embed all:out
var dist embed.FS

// FS returns the built dashboard, or an error if `npm run build` hasn't been run.
func FS() (fs.FS, error) {
	sub, err := fs.Sub(dist, "out")
	if err != nil {
		return nil, err
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, errors.New("web/out/index.html missing")
	}
	return sub, nil
}
