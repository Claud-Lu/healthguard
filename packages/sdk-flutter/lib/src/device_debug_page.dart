import 'package:flutter/material.dart';
import '../healthguard_flutter.dart';

/// Mount this route in the consuming app's existing debug/settings navigation.
class HealthGuardDeviceDebugPage extends StatefulWidget {
  const HealthGuardDeviceDebugPage({super.key, required this.client});
  final HealthGuardClient client;
  @override
  State<HealthGuardDeviceDebugPage> createState() => _DeviceDebugState();
}

class _DeviceDebugState extends State<HealthGuardDeviceDebugPage> {
  late final Future<void> ready = widget.client.initialize();
  @override
  Widget build(BuildContext context) => Scaffold(
      appBar: AppBar(title: const Text('HealthGuard 设备诊断')),
      body: FutureBuilder<void>(
          future: ready,
          builder: (context, snapshot) {
            final device = widget.client.deviceIdentity;
            return ListView(padding: const EdgeInsets.all(20), children: [
              const Text('设备短码 / Device code'),
              SelectableText(device.shortCode,
                  style: Theme.of(context).textTheme.headlineMedium),
              if (snapshot.connectionState != ConnectionState.done)
                const LinearProgressIndicator(),
              Text('标识状态: ${device.available ? "已获取" : "未获取"}'),
              Text('来源: ${device.source ?? "未获取"}'),
              Text('作用域: ${device.scope ?? "未获取"}'),
              if (!device.available) Text('原因: ${device.reason ?? "未获取"}'),
              Text('设备型号: ${device.model ?? "未获取"}'),
              Text('系统版本: ${device.system ?? "未获取"}'),
              Text(
                  'App 版本: ${widget.client.appVersion.isEmpty ? "未获取" : widget.client.appVersion}'),
              const Text('SDK: $healthGuardSdkVersion'),
              const SizedBox(height: 20),
              const Text(
                  '短码用于现场对照；完整标识用于归集。恢复出厂设置、切换系统用户、签名或应用作用域变化可能改变标识。标识未获取不影响业务与异常上报。'),
            ]);
          }));
}
