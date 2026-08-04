variable "name" {
  type        = string
  description = "Function App name (globally unique — becomes <name>.azurewebsites.net)."
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "storage_blob_endpoint" {
  type        = string
  description = "The backing storage account's primary blob endpoint (trailing slash included)."
}

variable "deploy_container_name" {
  type        = string
  description = "Blob container that hosts the deployment package."
}

variable "storage_access_key" {
  type      = string
  sensitive = true
}

variable "app_settings" {
  type    = map(string)
  default = {}
}

variable "restrict_to_front_door" {
  type        = bool
  default     = true
  description = "Allow ingress only from the AzureFrontDoor.Backend service tag (the SWA linked-backend path); everything else is denied. Disable if the first-apply validation shows SWA traffic arriving outside that tag."
}

variable "tags" {
  type    = map(string)
  default = {}
}
