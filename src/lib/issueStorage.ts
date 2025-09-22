export interface Issue {
  id: string;
  title: string;
  description: string;
  location: string;
  status: 'pending' | 'in-progress' | 'resolved';
  priority: 'low' | 'medium' | 'high';
  reportedBy: string;
  phone: string;
  reportedAt: string;
  assignedTo?: string;
  imageUrl?: string;
  aiDetectedProblem?: string;
}

const STORAGE_KEY = 'sanitation_issues';

export const saveIssue = (issue: Omit<Issue, 'id' | 'status' | 'priority' | 'reportedAt'>): Issue => {
  const issues = getIssues();
  const newIssue: Issue = {
    ...issue,
    id: Date.now().toString(),
    status: 'pending',
    priority: 'medium', // Default priority
    reportedAt: new Date().toISOString(),
  };
  
  issues.unshift(newIssue); // Add to beginning of array
  localStorage.setItem(STORAGE_KEY, JSON.stringify(issues));
  return newIssue;
};

export const getIssues = (): Issue[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading issues:', error);
    return [];
  }
};

export const updateIssue = (id: string, updates: Partial<Issue>): void => {
  const issues = getIssues();
  const index = issues.findIndex(issue => issue.id === id);
  if (index !== -1) {
    issues[index] = { ...issues[index], ...updates };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(issues));
  }
};

export const deleteIssue = (id: string): void => {
  const issues = getIssues();
  const filtered = issues.filter(issue => issue.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
};

// AI problem detection simulation
export const detectProblemFromImage = async (imageFile: File): Promise<string> => {
  // Simulate AI detection based on common sanitation issues
  const problems = [
    'Garbage overflow detected',
    'Blocked drain identified',
    'Pothole spotted',
    'Broken toilet facilities',
    'Littering detected',
    'Sewage overflow',
    'Damaged road surface',
    'Illegal dumping'
  ];
  
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Return random problem for simulation
  return problems[Math.floor(Math.random() * problems.length)];
};