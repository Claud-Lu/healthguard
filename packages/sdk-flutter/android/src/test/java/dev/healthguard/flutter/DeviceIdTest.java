package dev.healthguard.flutter;

/** Pure-JDK contract test. Android/OEM lifecycle behavior still requires actual tablets. */
public final class DeviceIdTest {
    public static void main(String[] args) throws Exception {
        String scope = "android_user_signing_key_app";
        String a = DeviceId.create("0123456789abcdef", "example.app", "demo", scope);
        if (!a.matches("hgd1_[a-f0-9]{64}")) throw new AssertionError("SHA-256 format");
        if (!a.equals(DeviceId.create("0123456789ABCDEF", "example.app", "demo", scope))) throw new AssertionError("Normalization/restart");
        if (a.equals(DeviceId.create("fedcba9876543210", "example.app", "demo", scope))) throw new AssertionError("Different devices");
        if (a.equals(DeviceId.create("0123456789abcdef", "other.app", "demo", scope))) throw new AssertionError("App isolation");
        if (a.equals(DeviceId.create("0123456789abcdef", "example.app", "other", scope))) throw new AssertionError("Project isolation");
        if (a.equals(DeviceId.create("0123456789abcdef", "example.app", "demo", "android_user_app_legacy"))) throw new AssertionError("Scope isolation");
        for (String raw : new String[] { null, "", "0000000000000000", "9774d56d682e549c", "invalid-id", "12345678901234567890" }) {
            if (DeviceId.create(raw, "example.app", "demo", scope) != null) throw new AssertionError("Invalid identity");
        }
        System.out.println("Android pseudonym contract: passed");
    }
}
