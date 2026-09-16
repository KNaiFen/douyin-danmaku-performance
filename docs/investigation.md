# 调查记录

材料为 `.materials/` 中的抖音与 Bilibili 保存页面、配套脚本和样式，以及提取的抖音模块 367931、623680、150486。轨道分配和 Canvas 合成采用 [Danmaku 上游实现](https://github.com/weizhenye/Danmaku)，锁定 npm 版本 2.0.9，捆绑脚本保留 MIT 许可。

## 已确认的代码路径

抖音原引擎使用 DOM 弹幕。业务 bulletCreateEl 为每条显示中的弹幕调用 React 渲染，包括文字、表情和点赞/举报/删除节点；组件还注册可见性和属性观察器。大量弹幕会增加 DOM、组件和观察器开销。

原引擎的移动与字号变化涉及位置读取、样式写入、暂停及重启。setFontSizeV1 反复 findIndex 查找待更新弹幕，updateQueueTimestamp 逐条读取位置并更新 transform/transition，存在随队列增长的布局处理成本。

业务在 SEEKING 清理缓存并 stop，SEEKED 时 clear/stop/start，然后异步加载网络批次。重建弹幕 DOM 与视频 seek 会争用主线程，但静态保存页面不足以确定某次卡顿的耗时占比。

Bilibili 保存页作为展示与渲染结构参考，不把“Bilibili 不卡”当作抖音卡顿原因的性能证明，也不复制其闭源引擎。

## 优化与限制

普通播放使用单 Canvas 合成，字形/表情 sprite 缓存预算为 16 MiB；时间轴二分查找跳转时间，逐帧不读取逐条 DOM 布局。用户悬停时才挂载一个原生交互节点，退出后同步点赞状态并调用 bulletDetached 卸载。

本地测试覆盖真实浏览器绘制、接口契约、密集队列和跳转后状态。尚未采集相同真实视频、网络和设备条件的完整 DevTools 对照轨迹，因此不承诺具体提速比例，也不能消除解码、网络或其他插件造成的卡顿。
