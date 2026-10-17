package config

import "testing"

func TestValidate(t *testing.T) {
	ok := Config{AdminKey: "0123456789abcdef0123456789abcdef", DefaultTZ: "UTC", MaxConcurrentRuns: 1, Env: "development"}
	if err := ok.Validate(); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	cases := map[string]func(c *Config){
		"missing key": func(c *Config) { c.AdminKey = "" },
		"short key":   func(c *Config) { c.AdminKey = "short" },
		"bad tz":      func(c *Config) { c.DefaultTZ = "Nowhere/Land" },
		"bad conc":    func(c *Config) { c.MaxConcurrentRuns = 0 },
		"bad env":     func(c *Config) { c.Env = "staging" },
	}
	for name, mut := range cases {
		c := ok
		mut(&c)
		if err := c.Validate(); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestLoadFromEnv(t *testing.T) {
	t.Setenv("ADMIN_KEY", "0123456789abcdef0123456789abcdef")
	t.Setenv("PORT", "9999")
	t.Setenv("ALLOW_SHELL", "false")
	t.Setenv("SESSION_SECRET", "")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.Port != 9999 || c.AllowShell || c.SessionSecret == "" {
		t.Fatalf("unexpected config: %+v", c)
	}
}
