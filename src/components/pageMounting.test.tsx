import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Tabs } from "antd";
import PageBoundary from "./PageBoundary";

describe("静态导入不提前挂载未访问页面", () => {
  it("首次只渲染当前页，不执行其他页面组件", () => {
    const mounted: string[] = [];
    function Page({ name }: { name: string }) {
      mounted.push(name);
      return <span>{name}</span>;
    }
    const html = renderToStaticMarkup(
      <Tabs
        activeKey="settings"
        destroyOnHidden={false}
        animated={false}
        renderTabBar={() => <></>}
        items={["dashboard", "settings", "history"].map((key) => ({
          key,
          label: key,
          children: (
            <PageBoundary pageKey={key}>
              <Page name={key} />
            </PageBoundary>
          ),
        }))}
      />,
    );
    expect(mounted).toEqual(["settings"]);
    expect(html).toContain("settings");
    expect(html).not.toContain("正在加载页面");
  });
});
