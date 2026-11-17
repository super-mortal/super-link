import { useEffect, useState } from 'react';

/**
 * recharts 配色的语义变量解析（决策 D9 + AGENTS.md「禁止写死颜色」）。
 *
 * 为什么不能直接把 var(--chart-1) 传给 recharts：recharts 的 stroke / fill 最终渲染成
 * SVG 的 presentation attribute，而 CSS 变量只能出现在 CSS 规则或 style 属性里，
 * presentation attribute 中写 var() 浏览器不解析（各内核行为不一致）。因此这里在运行时
 * 用 getComputedStyle 把 index.css 的设计 token 解析成具体色值再传给 recharts；
 * 主题切换（ThemeProvider 只改 documentElement 的 class）后重新解析，
 * 暗色主题自动跟随 :root / .dark 下的两套 --chart-* 值。
 */
export type ChartTokens = {
  /** CPU 面积图（--chart-1） */
  chart1: string;
  /** 内存面积图（--chart-2） */
  chart2: string;
  /** 网络接收折线（--chart-3，原型实线） */
  chart3: string;
  /** 网络发送折线（--chart-4，原型虚线） */
  chart4: string;
  /** 图表网格线（--border，原型 .chart-grid） */
  grid: string;
  /** 坐标轴标签（--muted-foreground，原型 .chart-ylab / .chart-xlab） */
  axis: string;
};

/** token 缺失时的兜底：currentColor 随文字色，保证取色失败时图表依然可见 */
const TOKEN_FALLBACK = 'currentColor';

const readTokens = (): ChartTokens => {
  const styles = window.getComputedStyle(document.documentElement);
  const read = (name: string) => styles.getPropertyValue(name).trim() || TOKEN_FALLBACK;

  return {
    chart1: read('--chart-1'),
    chart2: read('--chart-2'),
    chart3: read('--chart-3'),
    chart4: read('--chart-4'),
    grid: read('--border'),
    axis: read('--muted-foreground'),
  };
};

/** 取当前主题下的图表语义色；主题切换后自动重新解析（见文件头说明） */
export const useChartTokens = (): ChartTokens => {
  const [tokens, setTokens] = useState<ChartTokens>(readTokens);

  useEffect(() => {
    // 主题切换只改 <html> 的 class（见 ThemeProvider）：监听 class 变化重新取色，
    // 避免暗色主题下图表仍用亮色 token
    const observer = new MutationObserver(() => setTokens(readTokens()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return tokens;
};
