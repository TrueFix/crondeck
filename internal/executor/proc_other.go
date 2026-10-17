//go:build !unix

package executor

import "os/exec"

func setProcessGroup(cmd *exec.Cmd) {}
