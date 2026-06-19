import type { FlowRow } from './SankeyWidget';

export const sampleFlows: FlowRow[] = [
  { source: 'Website Ads', stage: 'Visit', target: 'Landing Page', value: 9800 },
  { source: 'Newsletter', stage: 'Signup', target: 'Free Trial', value: 7400 },
  { source: 'Partner Blog', stage: 'Signup', target: 'Free Trial', value: 5100 },
  { source: 'Marketplace', stage: 'Purchase', target: 'Paid Plan', value: 4300 },
  { source: 'Webinar', stage: 'Demo', target: 'Sales Pipeline', value: 2700 },
  { source: 'Support Docs', stage: 'Retention', target: 'Active Customer', value: 1850 },
  { source: 'Referral', stage: 'Purchase', target: 'Paid Plan', value: 1300 },
  { source: 'Community', stage: 'Feedback', target: 'Product Ideas', value: 850 },
  { source: 'Search', stage: 'Visit', target: 'Landing Page', value: 2600 },
  { source: 'Event Booth', stage: 'Demo', target: 'Sales Pipeline', value: 1200 },
];
