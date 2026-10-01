import {
  Component,
  lazy,
  Suspense,
  useMemo,
  useState,
  type ComponentType,
  type PropsWithChildren,
} from "react";
import { Alert, Button, Spin } from "antd";
import styles from "./components.module.scss";

class PageBoundary extends Component<
  PropsWithChildren<{ onRetry: () => void }>,
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: String(error) };
  }
  render() {
    return this.state.error ? (
      <Alert
        type="error"
        showIcon
        message="页面加载失败"
        description={this.state.error}
        action={<Button onClick={this.props.onRetry}>重试</Button>}
      />
    ) : (
      this.props.children
    );
  }
}

export default function DeferredPage<Props extends object>({
  load,
  pageProps,
}: {
  load: () => Promise<{ default: ComponentType<Props> }>;
  pageProps: Props;
}) {
  const [attempt, setAttempt] = useState(0);
  const Page = useMemo(() => lazy(load), [load, attempt]);
  return (
    <PageBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
      <Suspense
        fallback={
          <div className={styles.centerState}>
            <Spin />
            <span>正在加载页面…</span>
          </div>
        }
      >
        <Page {...pageProps} />
      </Suspense>
    </PageBoundary>
  );
}
