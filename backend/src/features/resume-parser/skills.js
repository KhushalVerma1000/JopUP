/**
 * Skills dictionary used by the rule-based resume parser.
 *
 * Each entry is the canonical display form. Matching is case-insensitive and
 * token-bounded (so "java" does not match inside "javascript"). Add to this
 * list freely — it is the cheapest way to improve skill extraction accuracy.
 * Aliases map alternate spellings to a canonical name.
 */
const SKILLS = [
  // Languages
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C', 'C++', 'C#', 'Go', 'Rust', 'PHP', 'Ruby', 'Kotlin', 'Swift',
  'Scala', 'R', 'MATLAB', 'Perl', 'Dart', 'SQL', 'PL/SQL', 'Bash', 'Shell Scripting', 'PowerShell', 'VBA',
  // Web / frontend
  'HTML', 'CSS', 'SASS', 'Tailwind CSS', 'Bootstrap', 'React', 'React Native', 'Next.js', 'Redux', 'Angular',
  'Vue.js', 'Svelte', 'jQuery', 'Webpack', 'Vite', 'GraphQL', 'REST API', 'WebSockets',
  // Backend / frameworks
  'Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring Boot', 'Spring', 'Hibernate', '.NET',
  'ASP.NET', 'Laravel', 'Ruby on Rails', 'Microservices',
  // Data / DB
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Oracle', 'SQL Server', 'SQLite', 'Elasticsearch', 'Cassandra',
  'DynamoDB', 'Firebase', 'Snowflake', 'BigQuery', 'Hadoop', 'Spark', 'Kafka', 'Airflow', 'ETL', 'Power BI',
  'Tableau', 'Excel', 'Data Analysis', 'Data Modeling', 'Data Warehousing',
  // ML / AI
  'Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision', 'TensorFlow', 'PyTorch', 'Scikit-learn',
  'Pandas', 'NumPy', 'LLM', 'Generative AI', 'OpenCV',
  // Cloud / DevOps
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins', 'CI/CD', 'GitHub Actions',
  'GitLab', 'Git', 'Linux', 'Nginx', 'Prometheus', 'Grafana', 'DevOps',
  // Mobile / QA
  'Android', 'iOS', 'Flutter', 'Selenium', 'Cypress', 'Playwright', 'Jest', 'JUnit', 'Postman', 'Manual Testing',
  'Automation Testing', 'API Testing', 'Performance Testing', 'JMeter',
  // Product / design / mgmt
  'Agile', 'Scrum', 'Jira', 'Product Management', 'Project Management', 'Figma', 'Adobe Photoshop',
  'Adobe Illustrator', 'UI/UX', 'Wireframing', 'Business Analysis', 'Requirement Gathering',
  // Business / sales / marketing / finance
  'Sales', 'B2B Sales', 'Lead Generation', 'Business Development', 'Cold Calling', 'CRM', 'Salesforce', 'HubSpot',
  'Account Management', 'Customer Support', 'Customer Service', 'Client Relationship', 'Negotiation',
  'Digital Marketing', 'SEO', 'SEM', 'Content Writing', 'Copywriting', 'Social Media Marketing', 'Google Ads',
  'Email Marketing', 'Market Research',
  'Accounting', 'Tally', 'GST', 'Taxation', 'Financial Analysis', 'Financial Modeling', 'Auditing', 'Payroll',
  'SAP', 'QuickBooks', 'Budgeting', 'Accounts Payable', 'Accounts Receivable',
  // HR / operations / misc
  'Recruitment', 'Talent Acquisition', 'Sourcing', 'Screening', 'Onboarding', 'Employee Engagement',
  'HR Operations', 'Payroll Processing', 'Performance Management', 'Applicant Tracking System',
  'Supply Chain', 'Logistics', 'Inventory Management', 'Procurement', 'Operations Management', 'MS Office',
  // Banking / finance / insurance / loans
  'Loan Processing', 'Loan Disbursement', 'Loan Documentation', 'Microfinance', 'KYC', 'Document Verification',
  'EMI Collection', 'Collections', 'Credit Appraisal', 'Underwriting', 'Insurance Sales', 'Life Insurance',
  'General Insurance', 'Channel Sales', 'Bancassurance', 'Cross-selling', 'CASA', 'Retail Banking', 'Mutual Funds',
  'Wealth Management', 'Branch Management', 'Team Handling', 'Team Management', 'Customer Counselling',
  'Back Office', 'Data Entry', 'MIS Reporting', 'Group Formation',
  // Field sales / FMCG / auto
  'Field Sales', 'FMCG', 'Retail Sales', 'Primary Sales', 'Secondary Sales', 'Distributor Management',
  'Dealer Management', 'Dealer Network Development', 'Territory Management', 'Territory Expansion',
  'Market Development', 'Market Expansion', 'Order Generation', 'Payment Collection', 'Beat Planning',
  'Key Account Management', 'Channel Partner Management', 'Target Achievement', 'Sales Reporting',
  'Competitor Analysis', 'Retailer Handling', 'Spare Parts', 'Automotive Sales', 'Inside Sales', 'Telesales',
  'Customer Acquisition', 'Relationship Management', 'Lead Conversion', 'Customer Handling',
  // HR / recruitment
  'End-to-End Recruitment', 'Blue-Collar Hiring', 'Bulk Hiring', 'Interview Coordination', 'Employer Branding',
  'Recruitment MIS', 'LinkedIn Recruiter', 'Naukri', 'Job Portals', 'Offer Management', 'Background Verification',
  'Attendance Management', 'Statutory Compliance', 'ESIC', 'Joining Formalities', 'Exit Interviews',
  // General office / other
  'Teamwork', 'Documentation', 'Report Making', 'Computer Hardware', 'Networking', 'Tally ERP', 'Typing',
  'MS Word', 'MS PowerPoint', 'AutoCAD', 'Quick Learning', 'RS-CIT',
  'Communication Skills', 'Team Leadership', 'Leadership', 'Stakeholder Management', 'Time Management',
  'Problem Solving',
];

const ALIASES = {
  tailwindcss: 'Tailwind CSS', 'tailwind css': 'Tailwind CSS', 'loan documentation': 'Loan Documentation',
  'end to end recruitment': 'End-to-End Recruitment', 'blue collar hiring': 'Blue-Collar Hiring',
  'blue-collar recruitment': 'Blue-Collar Hiring', 'blue collar recruitment': 'Blue-Collar Hiring',
  'bulk recruitment': 'Bulk Hiring', 'multi-location hiring': 'Bulk Hiring', 'cross selling': 'Cross-selling',
  'team handling': 'Team Handling', 'channel partner': 'Channel Partner Management', 'tally': 'Tally ERP',
  'recruitment trackers': 'Recruitment MIS', 'mis': 'MIS Reporting', 'kyc verification': 'KYC',
  'fast moving consumer goods': 'FMCG', 'auto spare parts': 'Spare Parts', 'automotive spare parts': 'Spare Parts',
  'dealer & distributor management': 'Distributor Management', 'distributor handling': 'Distributor Management',
  'primary & secondary sales': 'Primary Sales', 'market coverage': 'Market Expansion',
  js: 'JavaScript', ecmascript: 'JavaScript', ts: 'TypeScript', py: 'Python', golang: 'Go', 'c plus plus': 'C++',
  reactjs: 'React', 'react.js': 'React', nextjs: 'Next.js', 'next js': 'Next.js', vuejs: 'Vue.js', 'vue': 'Vue.js',
  angularjs: 'Angular', nodejs: 'Node.js', 'node js': 'Node.js', node: 'Node.js', expressjs: 'Express',
  'express.js': 'Express', postgres: 'PostgreSQL', postgresql: 'PostgreSQL', mongo: 'MongoDB', mssql: 'SQL Server',
  'amazon web services': 'AWS', 'google cloud': 'GCP', 'google cloud platform': 'GCP', k8s: 'Kubernetes',
  'sklearn': 'Scikit-learn', 'scikit learn': 'Scikit-learn', 'natural language processing': 'NLP',
  'ms excel': 'Excel', 'microsoft excel': 'Excel', 'ms office': 'MS Office', 'microsoft office': 'MS Office',
  'restful api': 'REST API', 'restful apis': 'REST API', 'rest apis': 'REST API', 'ui ux': 'UI/UX', 'ux': 'UI/UX',
  'ci cd': 'CI/CD', 'tailwind': 'Tailwind CSS', 'springboot': 'Spring Boot', 'dotnet': '.NET', 'dot net': '.NET',
  'ror': 'Ruby on Rails', 'talent sourcing': 'Sourcing', 'ats': 'Applicant Tracking System',
  'selenium webdriver': 'Selenium', 'power bi': 'Power BI', 'powerbi': 'Power BI', 'bpo': 'Customer Support',
};

module.exports = { SKILLS, ALIASES };
