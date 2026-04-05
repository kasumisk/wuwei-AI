import { Card, Row, Col, Statistic, Progress } from 'antd';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';

// 路由配置
export const routeConfig = {
  name: 'charts',
  title: '图表展示',
  icon: 'chart',
  requireAuth: true,
  hideInMenu: true,
};

const ChartsPage = () => {
  // 模拟数据
  const salesData = {
    today: 12543,
    yesterday: 11289,
    growth: ((12543 - 11289) / 11289 * 100).toFixed(1),
  };

  const visitorData = {
    today: 8523,
    yesterday: 9234,
    growth: ((8523 - 9234) / 9234 * 100).toFixed(1),
  };

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={[16, 16]}>
        <Col span={12}>
          <Card title="销售统计">
            <Statistic
              title="今日销售额"
              value={salesData.today}
              precision={0}
              valueStyle={{ color: '#3f8600' }}
              prefix={<ArrowUpOutlined />}
              suffix={`元 (+${salesData.growth}%)`}
            />
            <div style={{ marginTop: 16 }}>
              <div>昨日销售额: {salesData.yesterday} 元</div>
              <Progress 
                percent={75} 
                size="small" 
                style={{ marginTop: 8 }}
                status="active"
              />
            </div>
          </Card>
        </Col>

        <Col span={12}>
          <Card title="访客统计">
            <Statistic
              title="今日访客"
              value={visitorData.today}
              precision={0}
              valueStyle={{ color: '#cf1322' }}
              prefix={<ArrowDownOutlined />}
              suffix={`人 (${visitorData.growth}%)`}
            />
            <div style={{ marginTop: 16 }}>
              <div>昨日访客: {visitorData.yesterday} 人</div>
              <Progress 
                percent={60} 
                size="small" 
                style={{ marginTop: 8 }}
                status="exception"
              />
            </div>
          </Card>
        </Col>

        <Col span={24}>
          <Card title="趋势图表">
            <div style={{ 
              height: 300, 
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              fontSize: 18
            }}>
              图表组件区域
              <br />
              <small style={{ marginTop: 8, opacity: 0.8 }}>
                可集成 ECharts、AntV 等图表库
              </small>
            </div>
          </Card>
        </Col>

        <Col span={12}>
          <Card title="数据分布">
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Progress type="circle" percent={75} />
              <div style={{ marginTop: 16 }}>数据完整度</div>
            </div>
          </Card>
        </Col>

        <Col span={12}>
          <Card title="性能指标">
            <div>
              <div style={{ marginBottom: 16 }}>
                <div>响应时间</div>
                <Progress percent={30} size="small" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <div>CPU 使用率</div>
                <Progress percent={50} size="small" status="active" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <div>内存使用率</div>
                <Progress percent={80} size="small" status="exception" />
              </div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default ChartsPage;