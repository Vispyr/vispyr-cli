const vispyrBackendCommands = [
  '#!/bin/bash',
  'yum update -y',
  'yum install -y docker git nginx openssl',

  // Start and enable services
  'systemctl start docker',
  'systemctl enable docker',
  'systemctl start nginx',
  'systemctl enable nginx',
  'usermod -a -G docker ec2-user',

  // Install Docker Compose
  'curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose',
  'chmod +x /usr/local/bin/docker-compose',

  // Get instance metadata for certificate (with retries)
  'echo "Getting public DNS name..."',
  'for i in {1..50}; do',
  '  DNS_NAME=$(ec2-metadata --public-hostname | cut -d " " -f2)',
  '  if [[ -n "$DNS_NAME" ]]; then',
  '    echo "DNS name resolved: $DNS_NAME"',
  '    break',
  '  fi',
  '  echo "Waiting for DNS name... attempt $i/50"',
  '  sleep 5',
  'done',
  'echo "Using DNS name: $DNS_NAME"',

  // Generate self-signed certificate
  'mkdir -p /etc/nginx/ssl',
  'openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\',
  '  -keyout /etc/nginx/ssl/grafana.key \\',
  '  -out /etc/nginx/ssl/grafana.crt \\',
  '  -subj "/C=US/ST=State/L=City/O=Organization/CN=${DNS_NAME}"',

  // Create nginx configuration with properly escaped variables
  'cat > /etc/nginx/conf.d/grafana.conf << "NGINX_EOF"',
  'server {',
  '    listen 443 ssl;',
  '    server_name DNS_NAME_PLACEHOLDER;',
  '',
  '    ssl_certificate /etc/nginx/ssl/grafana.crt;',
  '    ssl_certificate_key /etc/nginx/ssl/grafana.key;',
  '    ssl_protocols TLSv1.2 TLSv1.3;',
  '    ssl_ciphers HIGH:!aNULL:!MD5;',
  '',
  '    # Security headers',
  '    add_header X-Frame-Options DENY;',
  '    add_header X-Content-Type-Options nosniff;',
  '    add_header X-XSS-Protection "1; mode=block";',
  '',
  '    location / {',
  '        proxy_pass http://127.0.0.1:3000;',
  '        proxy_set_header Host $host;',
  '        proxy_set_header X-Real-IP $remote_addr;',
  '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
  '        proxy_set_header X-Forwarded-Proto $scheme;',
  '        proxy_buffering off;',
  '    }',
  '}',
  '',
  '# Redirect HTTP to HTTPS',
  'server {',
  '    listen 80;',
  '    server_name DNS_NAME_PLACEHOLDER;',
  '    return 301 https://$server_name$request_uri;',
  '}',
  'NGINX_EOF',

  // Replace placeholder with actual DNS name
  'sed -i "s/DNS_NAME_PLACEHOLDER/${DNS_NAME}/g" /etc/nginx/conf.d/grafana.conf',

  // Remove default nginx config
  'rm -f /etc/nginx/conf.d/default.conf',

  // Test and reload nginx
  'nginx -t && systemctl reload nginx',

  // Clone and start application
  'cd /home/ec2-user',
  `git clone https://github.com/Vispyr/vispyr-backend.git`,
  'chown -R ec2-user:ec2-user vispyr-backend',
  'cd vispyr-backend',

  // Start services and wait for Grafana to be ready
  '/usr/local/bin/docker-compose up -d',

  // Wait for Grafana to start
  'echo "Waiting for Grafana to start..."',
  'for i in {1..30}; do',
  '  if curl -s http://localhost:3000/api/health > /dev/null; then',
  '    echo "Grafana is ready"',
  '    break',
  '  fi',
  '  echo "Waiting for Grafana... ($i/30)"',
  '  sleep 10',
  'done',

  // Change bucket size to accomodate large server name
  'sed -i "/http {/a     server_names_hash_bucket_size 128;" /etc/nginx/nginx.conf',

  // Final nginx reload to ensure everything is working
  'systemctl reload nginx',

  'echo "Setup complete. HTTPS endpoint should be available."',
];

export default vispyrBackendCommands;
