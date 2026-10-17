import type { JobInput } from "@/lib/api";

export interface JobTemplate {
  id: string;
  title: string;
  description: string;
  category: "Monitoring" | "Data" | "Maintenance" | "Integrations";
  job: Partial<JobInput> & Pick<JobInput, "type" | "schedule" | "config">;
}

export const templates: JobTemplate[] = [
  {
    id: "health-check",
    title: "Health check ping",
    description: "GET an endpoint every 5 minutes and fail if it isn’t 2xx.",
    category: "Monitoring",
    job: {
      name: "API health check",
      type: "http",
      schedule: "*/5 * * * *",
      timeout_sec: 15,
      max_retries: 2,
      retry_backoff_sec: 10,
      tags: ["monitoring"],
      config: { url: "https://example.com/health", method: "GET" }
    }
  },
  {
    id: "webhook",
    title: "Webhook trigger",
    description: "POST a JSON payload to a webhook every hour.",
    category: "Integrations",
    job: {
      name: "Hourly webhook",
      type: "http",
      schedule: "0 * * * *",
      timeout_sec: 30,
      tags: ["webhook"],
      config: {
        url: "https://hooks.example.com/trigger",
        method: "POST",
        headers: { Authorization: "Bearer <token>" },
        body: '{\n  "event": "hourly.tick"\n}'
      }
    }
  },
  {
    id: "pg-backup",
    title: "PostgreSQL backup",
    description: "Nightly compressed pg_dump into a dated file.",
    category: "Data",
    job: {
      name: "Postgres nightly backup",
      type: "shell",
      schedule: "0 3 * * *",
      timeout_sec: 3600,
      max_retries: 1,
      retry_backoff_sec: 300,
      tags: ["backup", "database"],
      config: {
        command: 'pg_dump "$DATABASE_URL" | gzip > /backups/db-$(date +%F).sql.gz',
        env: { DATABASE_URL: "postgres://user:pass@localhost:5432/app" }
      }
    }
  },
  {
    id: "log-cleanup",
    title: "Log cleanup",
    description: "Delete log files older than 7 days every Sunday.",
    category: "Maintenance",
    job: {
      name: "Prune old logs",
      type: "shell",
      schedule: "0 4 * * 0",
      tags: ["maintenance"],
      config: { command: "find /var/log/myapp -name '*.log' -mtime +7 -print -delete" }
    }
  },
  {
    id: "disk-alert",
    title: "Disk usage guard",
    description: "Fail when the root disk is more than 90% full.",
    category: "Monitoring",
    job: {
      name: "Disk usage guard",
      type: "script",
      schedule: "*/15 * * * *",
      timeout_sec: 30,
      tags: ["monitoring", "disk"],
      config: {
        interpreter: "bash",
        source:
          'usage=$(df / | awk \'NR==2 {gsub("%",""); print $5}\')\necho "Root disk usage: ${usage}%"\nif [ "$usage" -gt 90 ]; then\n  echo "Disk almost full!" >&2\n  exit 1\nfi'
      }
    }
  },
  {
    id: "python-report",
    title: "Python daily report",
    description: "Weekday-morning Python script that prints a summary.",
    category: "Data",
    job: {
      name: "Daily report",
      type: "script",
      schedule: "0 9 * * MON-FRI",
      tags: ["report"],
      config: {
        interpreter: "python3",
        source:
          'import datetime, platform\n\nprint(f"Report generated at {datetime.datetime.now():%Y-%m-%d %H:%M}")\nprint(f"Host: {platform.node()}")\n'
      }
    }
  },
  {
    id: "docker-prune",
    title: "Docker prune",
    description: "Reclaim disk by pruning unused Docker data weekly.",
    category: "Maintenance",
    job: {
      name: "Docker system prune",
      type: "shell",
      schedule: "30 5 * * 0",
      timeout_sec: 900,
      tags: ["docker", "maintenance"],
      config: { command: "docker system prune -af --filter 'until=168h'" }
    }
  },
  {
    id: "ssl-expiry",
    title: "SSL expiry check",
    description: "Fail when a certificate expires in under 14 days.",
    category: "Monitoring",
    job: {
      name: "SSL certificate expiry",
      type: "script",
      schedule: "0 8 * * *",
      timeout_sec: 30,
      tags: ["ssl", "monitoring"],
      config: {
        interpreter: "bash",
        source:
          'HOST=example.com\nend=$(echo | openssl s_client -servername $HOST -connect $HOST:443 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)\ndays=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))\necho "$HOST expires in $days days ($end)"\n[ "$days" -ge 14 ]'
      }
    }
  },
  {
    id: "node-sync",
    title: "Node.js sync task",
    description: "Run a small Node script every 10 minutes.",
    category: "Integrations",
    job: {
      name: "Sync with API",
      type: "script",
      schedule: "*/10 * * * *",
      tags: ["sync"],
      config: {
        interpreter: "node",
        source:
          '(async () => {\n  const res = await fetch("https://api.github.com/zen");\n  console.log("status", res.status);\n  console.log(await res.text());\n  if (!res.ok) process.exit(1);\n})();\n'
      }
    }
  }
];

export function getTemplate(id: string | null | undefined) {
  return templates.find((t) => t.id === id);
}
