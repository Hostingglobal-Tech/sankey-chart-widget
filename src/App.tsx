import SankeyWidget from './SankeyWidget';
import { sampleFlows } from './sampleData';

export default function App() {
  return (
    <main className="demo-page">
      <div className="demo-shell">
        <div className="demo-hero">
          <h1>Sankey Chart Widget</h1>
          <p>
            source, stage, target, value 데이터만 넣으면 움직이는 Sankey 차트를 바로 그릴 수 있는
            React Canvas 컴포넌트입니다. 이 데모는 공개용 샘플 데이터만 사용합니다.
          </p>
        </div>
        <SankeyWidget flows={sampleFlows} dark title="Sankey Chart" />
      </div>
    </main>
  );
}
