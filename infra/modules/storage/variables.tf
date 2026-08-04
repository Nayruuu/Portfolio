variable "name" {
  type        = string
  description = "Storage account name (3-24 chars, lowercase alphanumeric, globally unique)."
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
