variable "name" {
  type = string
}

variable "location" {
  type        = string
  description = "Static Web Apps is region-limited (e.g. westeurope) — not available in France Central."
}

variable "resource_group_name" {
  type = string
}

variable "sku_tier" {
  type    = string
  default = "Free"
}

variable "sku_size" {
  type    = string
  default = "Free"
}

variable "custom_domain" {
  type        = string
  default     = null
  description = "Custom domain to bind (requires DNS validation). Null = skip; bind later once DNS points at the SWA."
}

variable "tags" {
  type    = map(string)
  default = {}
}
