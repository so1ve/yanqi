import {
  Activity,
  Book2,
  Bulb,
  ChartBar,
  Dashboard,
  Folder,
  Messages,
  Users,
} from "@vicons/tabler";
import { computed } from "vue";

import { useRoute } from "#imports";

const links = [
  { path: "/", label: "概览", icon: Dashboard },
  { path: "/groups", label: "群管理", icon: Users },
  { path: "/memories", label: "个人偏好", icon: Bulb },
  { path: "/logs", label: "运行日志", icon: Activity },
];
const groupLinks = [
  { path: "records", label: "纪要", icon: Book2 },
  { path: "messages", label: "原始消息", icon: Messages },
  { path: "resources", label: "资源管理", icon: Folder },
  { path: "members", label: "群成员", icon: Users },
  { path: "tasks", label: "后台任务", icon: Activity },
  { path: "memories", label: "群共享记忆", icon: Bulb },
  { path: "usage", label: "模型用量", icon: ChartBar },
];

export function useNavigation() {
  const route = useRoute();
  const selected = computed(
    () =>
      (route.params.group
        ? groupLinks.find((link) => link.path === route.path.split("/")[2])
        : links.find((link) => link.path === route.path)
      )?.label ?? "设置",
  );

  return { links, groupLinks, selected };
}
