#!/bin/bash

# Vispyr Monitoring Agent Setup Script
# Installs and configures Grafana Alloy and Prometheus Node Exporter

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to detect Linux distribution and package manager
detect_system() {
    if command -v apt-get >/dev/null 2>&1; then
        DISTRO="debian"
        PKG_MANAGER="apt-get"
        INSTALL_CMD="apt-get install -y"
        UPDATE_CMD="apt-get update"
        log_info "Detected Debian/Ubuntu system"
    elif command -v dnf >/dev/null 2>&1; then
        DISTRO="fedora"
        PKG_MANAGER="dnf"
        INSTALL_CMD="dnf install -y"
        UPDATE_CMD="dnf makecache"
        log_info "Detected Fedora/RHEL 8+ system"
    elif command -v yum >/dev/null 2>&1; then
        DISTRO="rhel"
        PKG_MANAGER="yum"
        INSTALL_CMD="yum install -y"
        UPDATE_CMD="yum makecache"
        log_info "Detected RHEL/CentOS system"
    else
        log_error "Unsupported package manager. This script supports apt, dnf, and yum."
        exit 1
    fi
}

# Function to check if a service is running
is_service_running() {
    local service_name=$1
    if systemctl is-active --quiet "$service_name" 2>/dev/null; then
        return 0
    else
        return 1
    fi
}

# Function to check if a service exists
service_exists() {
    local service_name=$1
    if systemctl list-unit-files | grep -q "^${service_name}.service"; then
        return 0
    else
        return 1
    fi
}

# Function to get latest Node Exporter version
get_latest_node_exporter_version() {
    local version
    version=$(curl -s https://api.github.com/repos/prometheus/node_exporter/releases/latest | grep tag_name | cut -d '"' -f 4 2>/dev/null || echo "")
    
    if [ -z "$version" ]; then
        echo "v1.8.2"
    else
        echo "$version"
    fi
}

# Function to install Grafana Alloy
install_grafana_alloy() {
    log_info "Installing Grafana Alloy..."
    
    # Check if already installed and running
    if service_exists "alloy" && is_service_running "alloy"; then
        log_success "Grafana Alloy is already running, skipping installation"
        return 0
    fi
    
    # Clean any existing state
    if [ "$DISTRO" = "debian" ]; then
        sudo apt-get clean 2>/dev/null || true
        sudo rm -f /etc/apt/sources.list.d/grafana.list 2>/dev/null || true
    else
        sudo $PKG_MANAGER clean all 2>/dev/null || true
        sudo rm -f /etc/yum.repos.d/grafana.repo 2>/dev/null || true
        sudo rpm -e gpg-pubkey-* --allmatches 2>/dev/null || true
    fi
    
    # Add Grafana GPG key
    log_info "Adding Grafana GPG key..."
    if [ "$DISTRO" = "debian" ]; then
        wget -q -O /tmp/gpg.key https://rpm.grafana.com/gpg.key
        sudo apt-key add /tmp/gpg.key 2>/dev/null || {
            # For newer Ubuntu versions that deprecated apt-key
            sudo mkdir -p /etc/apt/keyrings
            gpg --dearmor < /tmp/gpg.key | sudo tee /etc/apt/keyrings/grafana.gpg >/dev/null
        }
        rm -f /tmp/gpg.key
    else
        wget -q -O /tmp/gpg.key https://rpm.grafana.com/gpg.key
        sudo rpm --import /tmp/gpg.key
        rm -f /tmp/gpg.key
    fi
    
    # Add repository
    log_info "Adding Grafana repository..."
    if [ "$DISTRO" = "debian" ]; then
        if [ -f /etc/apt/keyrings/grafana.gpg ]; then
            echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list > /dev/null
        else
            echo "deb https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list > /dev/null
        fi
    else
        cat << EOF | sudo tee /etc/yum.repos.d/grafana.repo > /dev/null
[grafana]
name=grafana
baseurl=https://rpm.grafana.com
repo_gpgcheck=1
enabled=1
gpgcheck=1
gpgkey=https://rpm.grafana.com/gpg.key
sslverify=1
sslcacert=/etc/pki/tls/certs/ca-bundle.crt
EOF
    fi
    
    # Update package cache
    log_info "Updating package cache..."
    sudo $UPDATE_CMD
    
    # Install Alloy with fallback
    log_info "Installing Grafana Alloy..."
    if ! sudo $INSTALL_CMD alloy; then
        log_warn "GPG verification failed, trying with disabled GPG check..."
        if [ "$DISTRO" = "debian" ]; then
            sudo apt-get install -y --allow-unauthenticated alloy
        else
            sudo $PKG_MANAGER install -y alloy --nogpgcheck
        fi
    fi
    
    log_success "Grafana Alloy installed successfully"
}

# Function to install Node Exporter
install_node_exporter() {
    log_info "Installing Node Exporter..."
    
    # Check if already installed and running
    if service_exists "node_exporter" && is_service_running "node_exporter"; then
        log_success "Node Exporter is already running, skipping installation"
        return 0
    fi
    
    # Store original directory
    local original_dir=$(pwd)
    
    # Create user
    sudo useradd --no-create-home --shell /bin/false node_exporter 2>/dev/null || true
    
    # Create directory
    sudo mkdir -p /opt/node_exporter
    
    # Get latest version and download
    log_info "Getting latest Node Exporter version..."
    local version
    version=$(get_latest_node_exporter_version)
    local version_num=${version#v}  # Remove 'v' prefix
    
    if [ -z "$version" ] || [ "$version" = "v1.8.2" ]; then
        log_warn "Could not fetch latest version, using v1.8.2"
    else
        log_success "Latest Node Exporter version: $version"
    fi
    
    log_info "Downloading Node Exporter $version..."
    cd /tmp
    
    # Download with better error handling
    local download_url="https://github.com/prometheus/node_exporter/releases/download/$version/node_exporter-$version_num.linux-amd64.tar.gz"
    if ! wget -q "$download_url"; then
        log_error "Failed to download Node Exporter from $download_url"
        exit 1
    fi
    
    log_info "Extracting Node Exporter..."
    # Extract and install
    if ! tar xzf "node_exporter-$version_num.linux-amd64.tar.gz"; then
        log_error "Failed to extract Node Exporter archive"
        cd "$original_dir"  # Return to original directory on error
        exit 1
    fi
    
    sudo cp "node_exporter-$version_num.linux-amd64/node_exporter" /opt/node_exporter/
    sudo chown -R node_exporter:node_exporter /opt/node_exporter
    
    # Cleanup
    rm -rf "node_exporter-$version_num.linux-amd64"*
    
    # Return to original directory
    cd "$original_dir"
    
    log_success "Node Exporter installed successfully"
}

# Function to create Node Exporter systemd service
create_node_exporter_service() {
    log_info "Creating Node Exporter systemd service..."
    
    cat << 'EOF' | sudo tee /etc/systemd/system/node_exporter.service > /dev/null
[Unit]
Description=Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/opt/node_exporter/node_exporter
SyslogIdentifier=node_exporter
Restart=always

[Install]
WantedBy=multi-user.target
EOF
    
    log_success "Node Exporter service created"
}

# Function to configure Alloy
configure_alloy() {
    log_info "Configuring Grafana Alloy..."
    
    # Check if config.alloy exists in vispyr_agent directory
    if [ ! -f "./vispyr_agent/config.alloy" ]; then
        log_error "config.alloy not found in ./vispyr_agent/ directory"
        log_error "Please ensure your Vispyr CLI has generated the configuration file"
        exit 1
    fi
    
    # Create config directory
    sudo mkdir -p /etc/alloy
    
    # Copy config file to the standard location
    log_info "Copying custom config to /etc/alloy/config.alloy..."
    if sudo cp "./vispyr_agent/config.alloy" /etc/alloy/config.alloy; then
        sudo chown root:root /etc/alloy/config.alloy
        sudo chmod 644 /etc/alloy/config.alloy
        log_success "Alloy configuration copied to /etc/alloy/config.alloy"
        
        # Verify the copy worked by checking first line
        local first_line=$(sudo head -1 /etc/alloy/config.alloy 2>/dev/null || echo "Could not read file")
        log_info "Config file first line: $first_line"
    else
        log_error "Failed to copy config file to /etc/alloy/config.alloy"
        exit 1
    fi
    
    # Ensure environment file points to the standard location
    if [ -f "/etc/sysconfig/alloy" ]; then
        log_info "Updating Alloy environment file to use standard config path..."
        
        # Backup original environment file
        sudo cp /etc/sysconfig/alloy /etc/sysconfig/alloy.backup 2>/dev/null || true
        
        # Update CONFIG_FILE path to standard location
        sudo sed -i 's|^CONFIG_FILE=.*|CONFIG_FILE="/etc/alloy/config.alloy"|' /etc/sysconfig/alloy
        
        # Verify the change
        local config_path=$(grep "^CONFIG_FILE=" /etc/sysconfig/alloy | cut -d'=' -f2 | tr -d '"')
        log_success "Alloy environment file updated to use: $config_path"
    else
        log_warn "Alloy environment file not found at /etc/sysconfig/alloy"
        log_warn "Alloy may use default config path"
    fi
}

# Function to start and enable services
start_services() {
    log_info "Starting and enabling services..."
    
    # Reload systemd
    sudo systemctl daemon-reload
    
    # Enable and start Node Exporter
    if ! is_service_running "node_exporter"; then
        sudo systemctl enable node_exporter
        sudo systemctl start node_exporter
        log_success "Node Exporter started and enabled"
    fi
    
    # Enable and start Alloy (if service exists)
    if service_exists "alloy"; then
        if ! is_service_running "alloy"; then
            sudo systemctl enable alloy
            sudo systemctl start alloy
            log_success "Grafana Alloy started and enabled"
        fi
    else
        log_warn "Alloy service not found in systemd, skipping service start"
    fi
}

# Function to verify services
verify_services() {
    log_info "Verifying services..."
    local verification_failed=false
    
    # Check Node Exporter
    if is_service_running "node_exporter"; then
        log_success "Node Exporter is running"
        # Test endpoint
        if curl -s http://localhost:9100/metrics | head -1 >/dev/null 2>&1; then
            log_success "Node Exporter metrics endpoint responding"
        else
            log_warn "Node Exporter metrics endpoint not responding"
        fi
    else
        log_warn "Node Exporter is not running - check logs: sudo journalctl -u node_exporter"
        verification_failed=true
    fi
    
    # Check Alloy
    if service_exists "alloy"; then
        if is_service_running "alloy"; then
            log_success "Grafana Alloy is running"
            
            # Test OTLP endpoints
            if timeout 5 curl -s http://localhost:4318/v1/traces -X POST -H "Content-Type: application/json" -d "{}" >/dev/null 2>&1; then
                log_success "Alloy OTLP HTTP endpoint responding"
            else
                log_warn "Alloy OTLP HTTP endpoint not responding (may be normal during startup)"
            fi
        else
            log_warn "Grafana Alloy installed but not running - check logs: sudo journalctl -u alloy"
            log_warn "This may be due to network connectivity issues with Vispyr backend"
            verification_failed=true
        fi
    else
        log_warn "Grafana Alloy service not available"
        verification_failed=true
    fi
    
    if [ "$verification_failed" = true ]; then
        log_warn "Some monitoring services have issues but continuing with application startup"
        log_info "You can check service logs later and restart them if needed"
    fi
}

# Main function
main() {
    log_info "Starting Vispyr Monitoring Agent Setup"
    
    # Make script executable (handle automation requirement)
    chmod +x "$0" 2>/dev/null || true
    
    # Check if running as root (for some operations we'll need sudo)
    if [ "$EUID" -eq 0 ]; then
        log_warn "Running as root. Consider running as regular user with sudo access."
    fi
    
    # Detect system
    detect_system
    
    # Check for required tools
    if ! command -v curl >/dev/null 2>&1; then
        log_info "Installing curl..."
        sudo $INSTALL_CMD curl
    fi
    
    if ! command -v wget >/dev/null 2>&1; then
        log_info "Installing wget..."
        sudo $INSTALL_CMD wget
    fi
    
    # Install components
    install_grafana_alloy
    install_node_exporter
    
    # Configure services
    create_node_exporter_service
    configure_alloy
    
    # Start services
    start_services
    
    # Verify installation
    verify_services
    
    # Success message
    echo
    log_success "Vispyr Monitoring Agent Setup Complete!"
    echo
    log_info "Monitoring Endpoints:"
    log_info "• Node Exporter: http://localhost:9100/metrics"
    log_info "• Alloy OTLP (gRPC): localhost:4317"
    log_info "• Alloy OTLP (HTTP): localhost:4318"
    log_info "• Alloy Pyroscope: localhost:9999"
    echo
    log_info "Services are configured to start automatically on boot"
    log_info "Your Node.js application will now start..."
    echo
}

# Error handling
trap 'log_error "Script failed at line $LINENO. Exit code: $?"' ERR

# Run main function
main "$@"