package executor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/honk/crondeck/internal/store"
)

type ShellConfig struct {
	Command string            `json:"command"`
	Workdir string            `json:"workdir"`
	Env     map[string]string `json:"env"`
}

type Shell struct{}

func (s *Shell) Validate(raw json.RawMessage) error {
	var c ShellConfig
	if err := json.Unmarshal(raw, &c); err != nil {
		return fmt.Errorf("invalid shell config: %w", err)
	}
	if strings.TrimSpace(c.Command) == "" {
		return errors.New("command is required")
	}
	return validateEnv(c.Env)
}

func (s *Shell) Run(ctx context.Context, job *store.Job, out *Output) Result {
	var c ShellConfig
	if err := json.Unmarshal(job.Config, &c); err != nil {
		return Result{Error: err.Error()}
	}
	return runProcess(ctx, "sh", []string{"-c", c.Command}, c.Workdir, c.Env, out)
}

// ---------------------------------------------------------------- script

type ScriptConfig struct {
	Interpreter string            `json:"interpreter"`
	Source      string            `json:"source"`
	Workdir     string            `json:"workdir"`
	Env         map[string]string `json:"env"`
}

// Interpreters maps allowed interpreters to temp-file extensions.
var Interpreters = map[string]string{
	"bash": ".sh", "sh": ".sh", "python3": ".py", "node": ".js", "ruby": ".rb", "perl": ".pl", "php": ".php",
}

type Script struct{}

func (s *Script) Validate(raw json.RawMessage) error {
	var c ScriptConfig
	if err := json.Unmarshal(raw, &c); err != nil {
		return fmt.Errorf("invalid script config: %w", err)
	}
	if _, ok := Interpreters[c.Interpreter]; !ok {
		return fmt.Errorf("unsupported interpreter %q", c.Interpreter)
	}
	if strings.TrimSpace(c.Source) == "" {
		return errors.New("source is required")
	}
	return validateEnv(c.Env)
}

func (s *Script) Run(ctx context.Context, job *store.Job, out *Output) Result {
	var c ScriptConfig
	if err := json.Unmarshal(job.Config, &c); err != nil {
		return Result{Error: err.Error()}
	}
	ext, ok := Interpreters[c.Interpreter]
	if !ok {
		return Result{Error: fmt.Sprintf("unsupported interpreter %q", c.Interpreter)}
	}
	if _, err := exec.LookPath(c.Interpreter); err != nil {
		return Result{Error: fmt.Sprintf("interpreter %q not found on host", c.Interpreter)}
	}
	f, err := os.CreateTemp("", "crondeck-*"+ext)
	if err != nil {
		return Result{Error: err.Error()}
	}
	defer os.Remove(f.Name())
	if _, err := f.WriteString(c.Source); err != nil {
		f.Close()
		return Result{Error: err.Error()}
	}
	f.Close()
	return runProcess(ctx, c.Interpreter, []string{f.Name()}, c.Workdir, c.Env, out)
}

// ---------------------------------------------------------------- process helper

func validateEnv(env map[string]string) error {
	for k := range env {
		if k == "" || strings.ContainsAny(k, "= \t\r\n") {
			return fmt.Errorf("invalid env var name %q", k)
		}
	}
	return nil
}

func runProcess(ctx context.Context, name string, args []string, workdir string, env map[string]string, out *Output) Result {
	cmd := exec.CommandContext(ctx, name, args...)
	if workdir != "" {
		wd := workdir
		if !filepath.IsAbs(wd) {
			if abs, err := filepath.Abs(wd); err == nil {
				wd = abs
			}
		}
		if st, err := os.Stat(wd); err != nil || !st.IsDir() {
			return Result{Error: fmt.Sprintf("workdir %q does not exist", workdir)}
		}
		cmd.Dir = wd
	}
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	cmd.Stdout = out
	cmd.Stderr = out
	setProcessGroup(cmd) // kill the whole tree on cancel/timeout
	cmd.WaitDelay = 3 * time.Second

	if err := cmd.Start(); err != nil {
		return Result{Error: err.Error()}
	}
	err := cmd.Wait()
	code := -1
	if cmd.ProcessState != nil {
		code = cmd.ProcessState.ExitCode()
	}
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) && code >= 0 {
			return Result{ExitCode: intPtr(code), Error: fmt.Sprintf("exit status %d", code)}
		}
		return Result{ExitCode: intPtr(code), Error: err.Error()}
	}
	return Result{OK: true, ExitCode: intPtr(code)}
}
