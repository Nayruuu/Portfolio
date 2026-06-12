variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "container_app_environment_id" {
  type = string
}

variable "image" {
  type        = string
  description = "Container image. Defaults to a placeholder for the first apply; the deploy-api workflow sets the real GHCR image."
  default     = "mcr.microsoft.com/k8se/quickstart:latest"
}

variable "target_port" {
  type    = number
  default = 8080
}

variable "max_replicas" {
  type    = number
  default = 1
}

variable "cpu" {
  type    = number
  default = 0.25
}

variable "memory" {
  type    = string
  default = "0.5Gi"
}

variable "cosmos_account_id" {
  type = string
}

variable "cosmos_account_name" {
  type = string
}

variable "cosmos_endpoint" {
  type = string
}

variable "cosmos_database_name" {
  type = string
}

variable "allowed_cors_origin" {
  type        = string
  description = "The SWA origin allowed by the API's CORS policy."
  default     = "https://super-dev.app"
}

variable "tags" {
  type    = map(string)
  default = {}
}
