import unittest

from deploy.tenant_portal_hosts import custom_portal_hosts


class CustomPortalHostTests(unittest.TestCase):
    def test_only_active_tenants_and_valid_external_hostnames_are_selected(self):
        payload = {
            "admins": [{"id": 1, "subdomain": "one"}, {"id": 2, "subdomain": "two"}],
            "branding": [
                {"admin_id": 1, "portal_hostname": " ocholasupernet.com "},
                {"admin_id": 2, "portal_hostname": "other.example.net"},
                {"admin_id": 90, "portal_hostname": "inactive.example.net"},
                {"admin_id": 1, "portal_hostname": "https://bad.example.com"},
                {"admin_id": 1, "portal_hostname": "192.0.2.4"},
                {"admin_id": 1, "portal_hostname": "deep..example.com"},
            ],
        }

        self.assertEqual(
            custom_portal_hosts(payload, "isplatty.org"),
            ["ocholasupernet.com", "other.example.net"],
        )

    def test_existing_base_and_first_level_tenant_hosts_are_not_duplicated(self):
        payload = {
            "admins": [{"id": 1, "subdomain": "one"}],
            "branding": [
                {"admin_id": 1, "portal_hostname": "isplatty.org"},
                {"admin_id": 1, "portal_hostname": "one.isplatty.org"},
                {"admin_id": 1, "portal_hostname": "nested.one.isplatty.org"},
            ],
        }

        self.assertEqual(
            custom_portal_hosts(payload, "isplatty.org"),
            ["nested.one.isplatty.org"],
        )

    def test_duplicate_custom_hostname_is_skipped(self):
        payload = {
            "admins": [{"id": 1}, {"id": 2}],
            "branding": [
                {"admin_id": 1, "portal_hostname": "shared.example.com"},
                {"admin_id": 2, "portal_hostname": "shared.example.com"},
            ],
        }

        self.assertEqual(custom_portal_hosts(payload, "isplatty.org"), [])


if __name__ == "__main__":
    unittest.main()