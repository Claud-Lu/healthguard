package dev.healthguard.flutter;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.NetworkRequest;
import android.os.Build;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import io.flutter.embedding.engine.plugins.FlutterPlugin;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;

/** No location permissions, SSID, BSSID, IP, carrier identity or active probes. */
public class HealthGuardPlugin implements FlutterPlugin, MethodChannel.MethodCallHandler {
    private MethodChannel channel;
    private ConnectivityManager manager;
    private ConnectivityManager.NetworkCallback callback;
    private final List<Map<String, Object>> changes = new ArrayList<>();
    private int users = 0;
    @Override public void onAttachedToEngine(FlutterPluginBinding binding) {
        manager = (ConnectivityManager) binding.getApplicationContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        channel = new MethodChannel(binding.getBinaryMessenger(), "healthguard/network");
        channel.setMethodCallHandler(this);
    }
    @Override public void onDetachedFromEngine(FlutterPluginBinding binding) {
        stop(); channel.setMethodCallHandler(null); manager = null;
    }
    @Override public void onMethodCall(MethodCall call, MethodChannel.Result result) {
        if (call.method.equals("start")) { users++; start(); result.success(null); }
        else if (call.method.equals("stop")) { users = Math.max(0, users - 1); if (users == 0) stop(); result.success(null); }
        else if (call.method.equals("snapshot")) { result.success(snapshot()); }
        else result.notImplemented();
    }
    private synchronized Map<String, Object> snapshot() {
        Map<String, Object> value = new HashMap<>();
        try {
            if (manager == null) return value;
            if (Build.VERSION.SDK_INT >= 23) {
                Network network = manager.getActiveNetwork();
                NetworkCapabilities caps = network == null ? null : manager.getNetworkCapabilities(network);
                if (network == null) { value.put("online", false); value.put("transport", "none"); }
                else if (caps != null) {
                    value.put("online", true);
                    value.put("validated", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
                    value.put("vpn", caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN));
                    value.put("transport", caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) ? "vpn" : caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? "wifi" : caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ? "cellular" : caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ? "ethernet" : "unknown");
                }
            } else {
                // API 21/22 cannot identify the default network with getActiveNetwork().
                // Preserve unavailable validated/VPN fields rather than inventing evidence.
                NetworkInfo info = manager.getActiveNetworkInfo();
                value.put("online", info != null && info.isConnected());
                value.put("transport", info == null || !info.isConnected() ? "none" : info.getType() == ConnectivityManager.TYPE_WIFI ? "wifi" : info.getType() == ConnectivityManager.TYPE_MOBILE ? "cellular" : info.getType() == ConnectivityManager.TYPE_ETHERNET ? "ethernet" : "unknown");
            }
            value.put("metered", manager.isActiveNetworkMetered());
        } catch (SecurityException ignored) { value.clear(); }
        long now = System.currentTimeMillis();
        List<Map<String, Object>> recent = new ArrayList<>();
        for (Map<String, Object> change : changes) {
            if (now - (Long) change.get("timestamp") <= 120000) recent.add(new HashMap<>(change));
        }
        value.put("recentChanges", recent);
        return value;
    }
    private synchronized void changed() {
        Map<String, Object> state = snapshot();
        state.remove("recentChanges");
        if (state.isEmpty()) return;
        Map<String, Object> change = new HashMap<>();
        change.put("timestamp", System.currentTimeMillis());
        if (state.containsKey("online")) change.put("online", state.get("online"));
        if (state.containsKey("transport")) change.put("transport", state.get("transport"));
        changes.add(change);
        if (changes.size() > 5) changes.remove(0);
    }
    private void start() {
        if (callback != null || manager == null) return;
        callback = new ConnectivityManager.NetworkCallback() {
            @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) { changed(); }
            @Override public void onLost(Network network) { changed(); }
        };
        try {
            if (Build.VERSION.SDK_INT >= 24) manager.registerDefaultNetworkCallback(callback);
            else manager.registerNetworkCallback(new NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), callback);
        } catch (SecurityException | IllegalArgumentException ignored) { callback = null; }
    }
    private void stop() {
        if (callback != null && manager != null) {
            try { manager.unregisterNetworkCallback(callback); } catch (IllegalArgumentException ignored) {}
        }
        callback = null;
        synchronized (this) { changes.clear(); }
    }
}
