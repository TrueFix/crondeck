package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// staticHandler serves a Next.js static export:
//   /jobs/       -> jobs/index.html   (trailingSlash: true)
//   /jobs        -> redirect to /jobs/ when jobs/index.html exists
//   unknown path -> 404.html with status 404
func staticHandler(root fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(root))
	exists := func(p string) bool {
		st, err := fs.Stat(root, p)
		return err == nil && !st.IsDir()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")

		if strings.HasPrefix(p, "_next/static/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}

		switch {
		case p == "" || p == ".":
			serveFile(w, r, root, "index.html", 200)
			return
		case exists(p):
			if strings.HasSuffix(p, "/index.html") || p == "index.html" {
				serveFile(w, r, root, p, 200)
				return
			}
			fileServer.ServeHTTP(w, r)
			return
		case exists(p + "/index.html"):
			if !strings.HasSuffix(r.URL.Path, "/") {
				target := r.URL.Path + "/"
				if r.URL.RawQuery != "" {
					target += "?" + r.URL.RawQuery
				}
				http.Redirect(w, r, target, http.StatusMovedPermanently)
				return
			}
			serveFile(w, r, root, p+"/index.html", 200)
			return
		case exists(p + ".html"):
			serveFile(w, r, root, p+".html", 200)
			return
		}
		if exists("404.html") {
			serveFile(w, r, root, "404.html", 404)
			return
		}
		http.NotFound(w, r)
	})
}

func serveFile(w http.ResponseWriter, r *http.Request, root fs.FS, name string, status int) {
	b, err := fs.ReadFile(root, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if strings.HasSuffix(name, ".html") {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	}
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(b)
	}
}
