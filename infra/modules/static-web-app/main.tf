resource "azurerm_static_web_app" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location

  sku_tier = var.sku_tier
  sku_size = var.sku_size

  tags = var.tags
}

# Optional custom-domain binding. Skipped until DNS for the domain points at the
# SWA (the binding waits on DNS-TXT validation, which would otherwise fail/hang).
resource "azurerm_static_web_app_custom_domain" "this" {
  count = var.custom_domain == null ? 0 : 1

  static_web_app_id = azurerm_static_web_app.this.id
  domain_name       = var.custom_domain
  validation_type   = "dns-txt-token"
}
