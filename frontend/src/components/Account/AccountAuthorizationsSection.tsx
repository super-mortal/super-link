import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.tsx';

/**
 * 授权关系占位区块（PRD §10.4）。
 *
 * 完整 UI（双列紧凑卡片、筛选、内部滚动、授权详情 / 新增 / 移除弹窗）在 task11 接入，
 * 这里先落地区块结构与授权数量，避免详情页出现「整块缺失」的割裂感。
 */
export const AccountAuthorizationsSection = ({ count }: { count: number }) => (
  <Card className="border-dashed">
    <CardHeader>
      <CardTitle className="text-base">授权关系</CardTitle>
      <CardDescription>共 {count} 条授权</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">授权管理开发中</p>
    </CardContent>
  </Card>
);
