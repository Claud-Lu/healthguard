package dev.healthguard.flutter;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

final class DeviceId {
    private DeviceId() {}
    static String create(String raw, String packageName, String appKey, String scope) throws Exception {
        if (raw == null || appKey == null || appKey.isEmpty()) return null;
        raw = raw.trim().toLowerCase(Locale.ROOT);
        if (!raw.matches("[a-f0-9]{1,16}") || raw.matches("0+") || raw.equals("9774d56d682e549c")) return null;
        String input = "healthguard-device-v1\0" + scope + "\0" + packageName + "\0" + appKey + "\0" + raw;
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));
        StringBuilder id = new StringBuilder("hgd1_");
        for (byte b : digest) id.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return id.toString();
    }
}
