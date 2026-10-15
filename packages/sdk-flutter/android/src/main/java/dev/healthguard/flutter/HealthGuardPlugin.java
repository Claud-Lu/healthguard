package dev.healthguard.flutter;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import io.flutter.embedding.engine.plugins.FlutterPlugin;
import io.flutter.plugin.common.EventChannel;
import io.flutter.plugin.common.MethodCall;
import io.flutter.plugin.common.MethodChannel;

/** One shared passive observer; no location, SSID, BSSID, IP, SIM or hardware ID. */
@SuppressWarnings("deprecation")
public class HealthGuardPlugin implements FlutterPlugin,
        MethodChannel.MethodCallHandler, EventChannel.StreamHandler {
    private Context app;
    private ConnectivityManager manager;
    private MethodChannel methods;
    private EventChannel events;
    private EventChannel.EventSink sink;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private ConnectivityManager.NetworkCallback callback;
    private boolean receiverRegistered;
    private int users;
    private long revision, observedAt;
    private String signature;
    private final List<Map<String, Object>> changes = new ArrayList<>();
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { publish("connectivity_broadcast", System.currentTimeMillis()); }
    };

    @Override public void onAttachedToEngine(FlutterPluginBinding binding) {
        app = binding.getApplicationContext();
        manager = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
        methods = new MethodChannel(binding.getBinaryMessenger(), "healthguard/network");
        methods.setMethodCallHandler(this);
        events = new EventChannel(binding.getBinaryMessenger(), "healthguard/network_events");
        events.setStreamHandler(this);
    }
    @Override public void onDetachedFromEngine(FlutterPluginBinding binding) {
        users = 0; sink = null; stop();
        methods.setMethodCallHandler(null); events.setStreamHandler(null);
        manager = null; app = null;
    }
    @Override public void onMethodCall(MethodCall call, MethodChannel.Result result) {
        switch (call.method) {
            case "start": users++; start(); result.success(null); break;
            case "stop": users = Math.max(0, users - 1); if (users == 0) stop(); result.success(null); break;
            case "snapshot": result.success(snapshot()); break;
            default: result.notImplemented();
        }
    }
    @Override public void onListen(Object args, EventChannel.EventSink next) {
        sink = next; users++; start(); publish("initial", System.currentTimeMillis());
    }
    @Override public void onCancel(Object args) {
        sink = null; users = Math.max(0, users - 1); if (users == 0) stop();
    }

    private synchronized Map<String, Object> snapshot() {
        Map<String, Object> value = new HashMap<>();
        long now = System.currentTimeMillis();
        try {
            if (manager == null || app == null) throw new IllegalStateException();
            NetworkInfo info = manager.getActiveNetworkInfo();
            Network network = Build.VERSION.SDK_INT >= 23 ? manager.getActiveNetwork() : null;
            NetworkCapabilities caps = network == null ? null : manager.getNetworkCapabilities(network);
            boolean connected = info != null && info.isConnected();
            String transport = "unknown";
            if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) transport = "vpn";
            else if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transport = "wifi";
            else if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transport = "cellular";
            else if (caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transport = "ethernet";
            else if (!connected) transport = "none";
            else if (info.getType() == ConnectivityManager.TYPE_WIFI) transport = "wifi";
            else if (info.getType() == ConnectivityManager.TYPE_MOBILE) transport = "cellular";
            else if (info.getType() == ConnectivityManager.TYPE_ETHERNET) transport = "ethernet";
            // The ephemeral handle distinguishes reconnects, but is never returned.
            String next = connected + "|" + transport + "|" + (network == null ? info == null ? "" : info.getType() : network.toString());
            if (!next.equals(signature)) { signature = next; revision++; observedAt = now; }
            value.put("available", true); value.put("online", connected); value.put("connected", connected);
            value.put("transport", transport); value.put("revision", revision);
            value.put("observedAt", observedAt); value.put("sampledAt", now);
            value.put("metered", manager.isActiveNetworkMetered());
            value.put("callbackRegistered", callback != null);
            value.put("androidSdk", Build.VERSION.SDK_INT);
            value.put("deviceModel", Build.MODEL); value.put("manufacturer", Build.MANUFACTURER);
            PowerManager power = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
            if (power != null) value.put("powerSaveMode", power.isPowerSaveMode());
            if (Build.VERSION.SDK_INT >= 23) {
                if (caps != null) {
                    value.put("validated", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
                    value.put("captivePortal", caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL));
                    value.put("vpn", caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN));
                }
                value.put("proxyConfigured", manager.getDefaultProxy() != null);
            }
        } catch (RuntimeException ignored) {
            value.clear(); value.put("available", false); value.put("observedAt", now);
        }
        List<Map<String, Object>> recent = new ArrayList<>();
        for (Map<String, Object> change : changes) {
            if (now - (Long) change.get("timestamp") <= 120000) recent.add(new HashMap<>(change));
        }
        value.put("recentChanges", recent);
        return value;
    }
    private void schedule(String reason) {
        long at = System.currentTimeMillis();
        handler.post(() -> { if (manager != null) publish(reason, at); });
    }
    private synchronized void publish(String reason, long at) {
        Map<String, Object> value = snapshot();
        Map<String, Object> change = new HashMap<>();
        change.put("timestamp", at);
        if (value.get("online") instanceof Boolean) change.put("online", value.get("online"));
        if (value.get("transport") instanceof String) change.put("transport", value.get("transport"));
        changes.add(change); if (changes.size() > 40) changes.remove(0);
        value.put("eventAt", at); value.put("reason", reason);
        value.put("eventScope", Build.VERSION.SDK_INT >= 24 ? "default_network" : "legacy_available_network");
        if (sink != null) sink.success(value);
    }
    private void start() {
        if (manager == null) return;
        if (!receiverRegistered) {
            try {
                IntentFilter filter = new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION);
                if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
                else app.registerReceiver(receiver, filter);
                receiverRegistered = true;
            } catch (RuntimeException ignored) {}
        }
        if (callback != null) return;
        ConnectivityManager.NetworkCallback next = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network n) { schedule("network_available"); }
            @Override public void onLost(Network n) { schedule("network_lost"); }
            @Override public void onCapabilitiesChanged(Network n, NetworkCapabilities c) { schedule("capabilities_changed"); }
        };
        try {
            if (Build.VERSION.SDK_INT >= 24) manager.registerDefaultNetworkCallback(next);
            else manager.registerNetworkCallback(new NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), next);
            callback = next;
        } catch (RuntimeException ignored) {}
    }
    private void stop() {
        if (callback != null && manager != null) {
            try { manager.unregisterNetworkCallback(callback); } catch (RuntimeException ignored) {}
        }
        callback = null;
        if (receiverRegistered && app != null) {
            try { app.unregisterReceiver(receiver); } catch (RuntimeException ignored) {}
        }
        receiverRegistered = false;
        handler.removeCallbacksAndMessages(null);
        synchronized (this) { changes.clear(); }
    }
}
