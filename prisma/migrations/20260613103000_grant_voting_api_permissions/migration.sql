-- Grant FORBASI Pusat access to the external e-voting endpoints.

UPDATE `api_keys`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'voting:read')
WHERE `name` = 'FORBASI Pusat'
  AND JSON_CONTAINS(`permissions`, JSON_QUOTE('voting:read')) = 0;

UPDATE `api_keys`
SET `permissions` = JSON_ARRAY_APPEND(`permissions`, '$', 'voting:write')
WHERE `name` = 'FORBASI Pusat'
  AND JSON_CONTAINS(`permissions`, JSON_QUOTE('voting:write')) = 0;
