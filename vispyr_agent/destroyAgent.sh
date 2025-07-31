#!/bin/bash

# Vispyr Monitoring Agent Teardown Script
# Removes Grafana Alloy and Prometheus Node Exporter

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
        REMOVE_CMD="apt-get remove -y"
        PURGE_CMD="apt-get purge -y"
        log_info "Detected Debian/Ubuntu system"
    elif command -v dnf >/dev/null 2>&1; then
        DISTRO="fedora"
        PKG_MANAGER="dnf"
        REMOVE_CMD="dnf remove -y"
        PURGE_CMD="dnf remove -y"
        log_info "Detected Fedora/RHEL 8+ system"
    elif command -v yum >/dev/null 2>&1; then
        DISTRO="rhel"
        PKG_MANAGER="yum"
        REMOVE_CMD="yum remove -y"
        PURGE_CMD="yum remove -y"
        log_info "Detected RHEL/CentOS system"
    else
        log_error "Unsupported package manager. This script supports apt, dnf, and yum."
        exit 1
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

# Function to stop and disable services
stop_services() {
    log_info "Stopping and disabling services..."
    
    # Stop and disable Alloy
    if service_exists "alloy"; then
        log_info "Stopping Alloy service..."
        sudo systemctl stop alloy 2>/dev/null || log_warn "Alloy service was not running"
        sudo systemctl disable alloy 2>/dev/null || log_warn "Alloy service was not enabled"
        log_success "Alloy service stopped and disabled"
    else
        log_info "Alloy service not found, skipping"
    fi
    
    # Stop and disable Node Exporter
    if service_exists "node_exporter"; then
        log_info "Stopping Node Exporter service..."
        sudo systemctl stop node_exporter 2>/dev/null || log_warn "Node Exporter service was not running"
        sudo systemctl disable node_exporter 2>/dev/null || log_warn "Node Exporter service was not enabled"
        log_success "Node Exporter service stopped and disabled"
    else
        log_info "Node Exporter service not found, skipping"
    fi
    
    # Reload systemd daemon
    sudo systemctl daemon-reload
    log_success "Systemd daemon reloaded"
}

# Function to remove packages
remove_packages() {
    log_info "Removing packages..."
    
    # Remove Grafana Alloy
    log_info "Removing Grafana Alloy package..."
    if sudo $REMOVE_CMD alloy 2>/dev/null; then
        log_success "Grafana Alloy package removed"
    else
        log_warn "Alloy package not found or already removed"
    fi
    
    # Note: We don't remove Node Exporter package since we installed it manually
    log_info "Node Exporter was installed manually, will remove files directly"
}

# Function to remove configuration files and directories
remove_config_files() {
    log_info "Removing configuration files and directories..."
    
    # Remove Alloy configuration
    if [ -d "/etc/alloy" ]; then
        log_info "Removing Alloy configuration directory..."
        sudo rm -rf /etc/alloy
        log_success "Alloy configuration removed"
    fi
    
    # Remove Alloy environment file (if it exists and we can safely remove it)
    if [ -f "/etc/sysconfig/alloy" ]; then
        log_info "Backing up and removing Alloy environment file..."
        sudo cp /etc/sysconfig/alloy /tmp/alloy.env.backup 2>/dev/null || true
        sudo rm -f /etc/sysconfig/alloy
        log_success "Alloy environment file removed (backup in /tmp/alloy.env.backup)"
    fi
    
    # Remove Node Exporter files
    if [ -d "/opt/node_exporter" ]; then
        log_info "Removing Node Exporter installation directory..."
        sudo rm -rf /opt/node_exporter
        log_success "Node Exporter files removed"
    fi
    
    # Remove Node Exporter systemd service
    if [ -f "/etc/systemd/system/node_exporter.service" ]; then
        log_info "Removing Node Exporter systemd service..."
        sudo rm -f /etc/systemd/system/node_exporter.service
        log_success "Node Exporter service file removed"
    fi
    
    # Remove Alloy data directory (if it exists)
    if [ -d "/var/lib/alloy" ]; then
        log_info "Removing Alloy data directory..."
        sudo rm -rf /var/lib/alloy
        log_success "Alloy data directory removed"
    fi
}

# Function to remove users
remove_users() {
    log_info "Removing system users..."
    
    # Remove node_exporter user
    if id "node_exporter" >/dev/null 2>&1; then
        log_info "Removing node_exporter user..."
        sudo userdel node_exporter 2>/dev/null || log_warn "Could not remove node_exporter user"
        log_success "node_exporter user removed"
    else
        log_info "node_exporter user not found, skipping"
    fi
    
    # Remove alloy user (if it exists and was created by package)
    if id "alloy" >/dev/null 2>&1; then
        log_info "Alloy user exists but was likely created by package manager, leaving it"
        log_info "It may be removed when you clean up repositories"
    fi
}

# Function to remove repositories
remove_repositories() {
    log_info "Removing package repositories..."
    
    if [ "$DISTRO" = "debian" ]; then
        # Remove Grafana repository
        if [ -f "/etc/apt/sources.list.d/grafana.list" ]; then
            log_info "Removing Grafana APT repository..."
            sudo rm -f /etc/apt/sources.list.d/grafana.list
            log_success "Grafana APT repository removed"
        fi
        
        # Remove GPG keys (be careful here)
        log_info "Removing Grafana GPG keys..."
        if [ -f "/etc/apt/keyrings/grafana.gpg" ]; then
            sudo rm -f /etc/apt/keyrings/grafana.gpg
        fi
        # Note: Not removing apt-key entries as they might be used by other packages
        
        # Update package cache
        sudo apt-get update 2>/dev/null || log_warn "Could not update package cache"
        
    else
        # Remove Grafana repository for RPM-based systems
        if [ -f "/etc/yum.repos.d/grafana.repo" ]; then
            log_info "Removing Grafana YUM repository..."
            sudo rm -f /etc/yum.repos.d/grafana.repo
            log_success "Grafana YUM repository removed"
        fi
        
        # Clean package cache
        sudo $PKG_MANAGER clean all 2>/dev/null || log_warn "Could not clean package cache"
    fi
}

# Function to clean up temporary files
cleanup_temp_files() {
    log_info "Cleaning up temporary files..."
    
    # Remove any backup files we created
    sudo rm -f /etc/alloy/config.alloy.backup 2>/dev/null || true
    
    # Remove any temporary files from installation
    rm -f /tmp/node_exporter-*.tar.gz 2>/dev/null || true
    rm -rf /tmp/node_exporter-* 2>/dev/null || true
    
    log_success "Temporary files cleaned up"
}

# Function to show final status
show_final_status() {
    log_info "Checking final status..."
    
    # Check if services still exist
    if service_exists "alloy"; then
        log_warn "⚠️  Alloy service still exists in systemd"
    else
        log_success "✅ Alloy service removed from systemd"
    fi
    
    if service_exists "node_exporter"; then
        log_warn "⚠️  Node Exporter service still exists in systemd"
    else
        log_success "✅ Node Exporter service removed from systemd"
    fi
    
    # Check if directories still exist
    if [ -d "/etc/alloy" ]; then
        log_warn "⚠️  Alloy configuration directory still exists"
    else
        log_success "✅ Alloy configuration directory removed"
    fi
    
    if [ -d "/opt/node_exporter" ]; then
        log_warn "⚠️  Node Exporter installation directory still exists"
    else
        log_success "✅ Node Exporter installation directory removed"
    fi
    
    # Check if users still exist
    if id "node_exporter" >/dev/null 2>&1; then
        log_warn "⚠️  node_exporter user still exists"
    else
        log_success "✅ node_exporter user removed"
    fi
}

# Main function
main() {
    log_info "🗑️  Starting Vispyr Monitoring Agent Teardown"
    echo
    
    # Confirm with user
    echo -e "${YELLOW}This will remove:${NC}"
    echo "• Grafana Alloy (package and configuration)"
    echo "• Prometheus Node Exporter (files and service)"
    echo "• Associated systemd services"
    echo "• Configuration files and directories"
    echo "• System users (node_exporter)"
    echo "• Package repositories (Grafana)"
    echo
    
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Teardown cancelled by user"
        exit 0
    fi
    
    echo
    log_info "Starting teardown process..."
    
    # Make script executable (handle automation requirement)
    chmod +x "$0" 2>/dev/null || true
    
    # Detect system
    detect_system
    
    # Execute teardown steps
    stop_services
    remove_packages
    remove_config_files
    remove_users
    remove_repositories
    cleanup_temp_files
    
    # Show final status
    echo
    show_final_status
    
    # Success message
    echo
    log_success "🎉 Vispyr Monitoring Agent Teardown Complete!"
    echo
    log_info "💡 What was removed:"
    log_info "• All monitoring services stopped and disabled"
    log_info "• Configuration files and directories deleted"
    log_info "• System users removed"
    log_info "• Package repositories cleaned up"
    echo
    log_info "📝 Notes:"
    log_info "• Your vispyr_agent/ directory in your project was NOT touched"
    log_info "• You can re-run the setup script anytime to reinstall"
    log_info "• Some package manager cache cleanup may be needed manually"
    echo
}

# Error handling
trap 'log_error "Teardown script failed at line $LINENO. Exit code: $?"' ERR

# Run main function
main "$@"