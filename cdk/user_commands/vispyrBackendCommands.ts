const vispyrBackendCommands = (domain?: string, email?: string): string[] => {
  const baseCommands = [
    '#!/bin/bash',
    'yum update -y',
    'yum install -y docker git nginx openssl python3-pip',

    // Start and enable services
    'systemctl start docker',
    'systemctl enable docker',
    'systemctl start nginx',
    'systemctl enable nginx',
    'usermod -a -G docker ec2-user',

    // Install Docker Compose
    'curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose',
    'chmod +x /usr/local/bin/docker-compose',

    // Install certbot via pip
    'echo "Installing certbot..."',
    'pip3 install certbot',
    'ln -sf /usr/local/bin/certbot /usr/bin/certbot',
    'echo "Certbot installed successfully"',
  ];

  const domainConfigCommands =
    domain && email
      ? [
          // Custom domain provided - attempt Let's Encrypt
          `DNS_NAME="vispyr.${domain}"`,
          `EMAIL="${email}"`,
          'USE_LETSENCRYPT=true',
          `echo "Using custom domain: ${domain}"`,
          `echo "Using email: ${email}"`,
          'echo "Will attempt Let\'s Encrypt certificate"',
        ]
      : [
          // No domain provided - use self-signed with EC2 DNS
          'echo "No custom domain provided - using self-signed certificate"',
          'USE_LETSENCRYPT=false',
          '# Get EC2 DNS for self-signed cert',
          'for i in {1..50}; do',
          '  DNS_NAME=$(ec2-metadata --public-hostname | cut -d " " -f2)',
          '  if [[ -n "$DNS_NAME" ]]; then',
          '    echo "Using EC2 DNS for self-signed cert: $DNS_NAME"',
          '    break',
          '  fi',
          '  echo "Waiting for EC2 DNS... attempt $i/50"',
          '  sleep 5',
          'done',
        ];

  const remainingCommands = [
    // Create web root for certbot webroot validation
    'mkdir -p /var/www/html',
    'chown -R nginx:nginx /var/www/html',
    'echo "Certbot validation server" > /var/www/html/index.html',

    // Create temporary HTTP-only nginx configuration for certificate acquisition
    'cat > /etc/nginx/conf.d/grafana.conf << "NGINX_EOF"',
    'server {',
    '    listen 80;',
    '    server_name DNS_NAME_PLACEHOLDER;',
    '',
    '    # Allow certbot validation',
    '    location /.well-known/acme-challenge/ {',
    '        root /var/www/html;',
    '    }',
    '',
    '    # Proxy everything else to the application',
    '    location / {',
    '        proxy_pass http://127.0.0.1:3000;',
    '        proxy_set_header Host $host;',
    '        proxy_set_header X-Real-IP $remote_addr;',
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    '        proxy_set_header X-Forwarded-Proto $scheme;',
    '        proxy_buffering off;',
    '    }',
    '}',
    'NGINX_EOF',

    // Replace placeholder with actual DNS name
    'sed -i "s/DNS_NAME_PLACEHOLDER/${DNS_NAME}/g" /etc/nginx/conf.d/grafana.conf',

    // Remove default nginx config and change bucket size
    'rm -f /etc/nginx/conf.d/default.conf',
    'sed -i "/http {/a     server_names_hash_bucket_size 128;" /etc/nginx/nginx.conf',

    // Test and reload nginx
    'nginx -t && systemctl reload nginx',

    // Clone and start application first (needed for health checks during cert process)
    'cd /home/ec2-user',
    'git clone https://github.com/Vispyr/vispyr-backend.git',
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

    // Obtain SSL certificate based on configuration
    'if [[ "$USE_LETSENCRYPT" == "true" ]]; then',
    '  echo "Attempting to obtain Let\'s Encrypt certificate..."',
    '  echo "Note: This requires DNS to be properly configured"',
    '  SSL_SUCCESS=false',
    '  ',
    '  # Try every 2 minutes for 30 minutes (15 attempts)',
    '  for attempt in {1..15}; do',
    '    echo "SSL attempt $attempt/15..."',
    '    if certbot certonly --webroot -w /var/www/html --non-interactive --agree-tos --email ${EMAIL} -d ${DNS_NAME}; then',
    '      echo "SSL certificate obtained successfully!"',
    '      SSL_SUCCESS=true',
    '      break',
    '    else',
    '      echo "SSL attempt $attempt/15 failed"',
    '      if [[ $attempt -lt 15 ]]; then',
    '        echo "DNS may not be configured yet. Retrying in 2 minutes..."',
    '        sleep 120',
    '      fi',
    '    fi',
    '  done',
    '  ',
    '  if [[ "$SSL_SUCCESS" != "true" ]]; then',
    '    echo "Let\'s Encrypt failed after 30 minutes, falling back to self-signed"',
    '  fi',
    'else',
    '  echo "Skipping Let\'s Encrypt (no domain configured)"',
    '  SSL_SUCCESS=false',
    'fi',

    // Set up certificates based on success/failure
    'if [[ "$SSL_SUCCESS" == "true" ]]; then',
    '  CERT_PATH="/etc/letsencrypt/live/${DNS_NAME}/fullchain.pem"',
    '  KEY_PATH="/etc/letsencrypt/live/${DNS_NAME}/privkey.pem"',
    '  echo "Using Let\'s Encrypt certificate"',
    'else',
    '  if [[ "$USE_LETSENCRYPT" == "true" ]]; then',
    '    echo "SSL certificate acquisition failed, falling back to self-signed certificate"',
    '  else',
    '    echo "Creating self-signed certificate"',
    '  fi',
    '  mkdir -p /etc/nginx/ssl',
    '  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\',
    '    -keyout /etc/nginx/ssl/grafana.key \\',
    '    -out /etc/nginx/ssl/grafana.crt \\',
    '    -subj "/C=US/ST=State/L=City/O=Organization/CN=${DNS_NAME}"',
    '  CERT_PATH="/etc/nginx/ssl/grafana.crt"',
    '  KEY_PATH="/etc/nginx/ssl/grafana.key"',
    '  echo "Using self-signed certificate"',
    'fi',

    // Create final nginx configuration with HTTPS
    'cat > /etc/nginx/conf.d/grafana.conf << "NGINX_EOF"',
    'server {',
    '    listen 443 ssl http2;',
    '    server_name DNS_NAME_PLACEHOLDER;',
    '',
    '    ssl_certificate CERT_PATH_PLACEHOLDER;',
    '    ssl_certificate_key KEY_PATH_PLACEHOLDER;',
    '    ssl_protocols TLSv1.2 TLSv1.3;',
    '    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;',
    '    ssl_prefer_server_ciphers on;',
    '',
    '    # Security headers',
    '    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;',
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
    '        proxy_read_timeout 86400;',
    '    }',
    '}',
    '',
    '# Redirect HTTP to HTTPS',
    'server {',
    '    listen 80;',
    '    server_name DNS_NAME_PLACEHOLDER;',
    '',
    '    # Allow certbot renewals',
    '    location /.well-known/acme-challenge/ {',
    '        root /var/www/html;',
    '    }',
    '',
    '    # Redirect everything else to HTTPS',
    '    location / {',
    '        return 301 https://$server_name$request_uri;',
    '    }',
    '}',
    'NGINX_EOF',

    // Replace placeholders with actual values
    'sed -i "s|DNS_NAME_PLACEHOLDER|${DNS_NAME}|g" /etc/nginx/conf.d/grafana.conf',
    'sed -i "s|CERT_PATH_PLACEHOLDER|${CERT_PATH}|g" /etc/nginx/conf.d/grafana.conf',
    'sed -i "s|KEY_PATH_PLACEHOLDER|${KEY_PATH}|g" /etc/nginx/conf.d/grafana.conf',

    // Test and reload nginx with final configuration
    'nginx -t && systemctl reload nginx',

    // Set up automatic certificate renewal (only if Let's Encrypt was successful)
    'if [[ "$SSL_SUCCESS" == "true" ]]; then',
    '  systemctl enable crond',
    '  systemctl start crond',
    '  echo "0 12 * * * /usr/bin/certbot renew --quiet && /usr/bin/systemctl reload nginx" | crontab -',
    '  echo "Certificate auto-renewal configured"',
    'fi',

    'echo "Setup complete!"',
    'if [[ "$USE_LETSENCRYPT" == "true" ]]; then',
    '  echo "Backend available at: https://$DNS_NAME"',
    'else',
    '  echo "Backend available at: https://$DNS_NAME"',
    'fi',
    'if [[ "$SSL_SUCCESS" == "true" ]]; then',
    '  echo "SSL certificate: Let\'s Encrypt (trusted)"',
    'else',
    '  echo "SSL certificate: Self-signed (browser will show warning)"',
    '  if [[ "$USE_LETSENCRYPT" != "true" ]]; then',
    '    echo "To use trusted SSL: set VISPYR_DOMAIN and VISPYR_EMAIL in CLI .env file and redeploy"',
    '  fi',
    'fi',
  ];

  return [...baseCommands, ...domainConfigCommands, ...remainingCommands];
};

export default vispyrBackendCommands;
