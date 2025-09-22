import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getIssues, updateIssue, Issue } from '@/lib/issueStorage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Map, 
  List, 
  AlertCircle, 
  Clock, 
  CheckCircle, 
  Users, 
  MapPin,
  Filter,
  User,
  Phone,
  Calendar,
  LogOut,
  Home
} from 'lucide-react';

const Dashboard = () => {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');

  // Load issues from localStorage on component mount
  useEffect(() => {
    const loadedIssues = getIssues();
    setIssues(loadedIssues);
  }, []);

  // Refresh issues periodically to catch new reports
  useEffect(() => {
    const interval = setInterval(() => {
      const loadedIssues = getIssues();
      setIssues(loadedIssues);
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const filteredIssues = issues.filter(issue => {
    const statusMatch = selectedStatus === 'all' || issue.status === selectedStatus;
    const priorityMatch = selectedPriority === 'all' || issue.priority === selectedPriority;
    return statusMatch && priorityMatch;
  });

  const updateIssueStatus = (id: string, newStatus: 'pending' | 'in-progress' | 'resolved') => {
    updateIssue(id, { status: newStatus });
    const updatedIssues = getIssues();
    setIssues(updatedIssues);
  };

  const assignIssue = (id: string, team: string) => {
    updateIssue(id, { assignedTo: team });
    const updatedIssues = getIssues();
    setIssues(updatedIssues);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="destructive" className="bg-accent"><AlertCircle className="h-3 w-3 mr-1" />Pending</Badge>;
      case 'in-progress':
        return <Badge variant="secondary" className="bg-warning text-warning-foreground"><Clock className="h-3 w-3 mr-1" />In Progress</Badge>;
      case 'resolved':
        return <Badge variant="secondary" className="bg-success text-success-foreground"><CheckCircle className="h-3 w-3 mr-1" />Resolved</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return <Badge variant="destructive">High</Badge>;
      case 'medium':
        return <Badge variant="secondary" className="bg-warning text-warning-foreground">Medium</Badge>;
      case 'low':
        return <Badge variant="outline">Low</Badge>;
      default:
        return <Badge>{priority}</Badge>;
    }
  };

  const stats = {
    total: issues.length,
    pending: issues.filter(i => i.status === 'pending').length,
    inProgress: issues.filter(i => i.status === 'in-progress').length,
    resolved: issues.filter(i => i.status === 'resolved').length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      <div className="border-b bg-card/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Authority Dashboard</h1>
              <p className="text-muted-foreground">Monitor and manage sanitation issues</p>
            </div>
            <div className="flex gap-2">
              <Link to="/">
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <Home className="h-4 w-4" />
                  Back to Home
                </Button>
              </Link>
              <Link to="/authority">
                <Button variant="outline" size="sm" className="flex items-center gap-2">
                  <LogOut className="h-4 w-4" />
                  Logout
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="bg-gradient-card border-0 shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="bg-primary/10 p-3 rounded-lg">
                  <List className="h-6 w-6 text-primary" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted-foreground">Total Issues</p>
                  <p className="text-2xl font-bold text-foreground">{stats.total}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-card border-0 shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="bg-accent/10 p-3 rounded-lg">
                  <AlertCircle className="h-6 w-6 text-accent" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted-foreground">Pending</p>
                  <p className="text-2xl font-bold text-foreground">{stats.pending}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-card border-0 shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="bg-warning/10 p-3 rounded-lg">
                  <Clock className="h-6 w-6 text-warning" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted-foreground">In Progress</p>
                  <p className="text-2xl font-bold text-foreground">{stats.inProgress}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-card border-0 shadow-md">
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className="bg-success/10 p-3 rounded-lg">
                  <CheckCircle className="h-6 w-6 text-success" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-muted-foreground">Resolved</p>
                  <p className="text-2xl font-bold text-foreground">{stats.resolved}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6 bg-gradient-card border-0 shadow-md">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <Filter className="h-5 w-5 text-muted-foreground" />
              <div className="flex gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="in-progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Priority</label>
                  <Select value={selectedPriority} onValueChange={setSelectedPriority}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Filter by priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Priorities</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Content */}
        <Tabs defaultValue="list" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="list" className="flex items-center gap-2">
              <List className="h-4 w-4" />
              List View
            </TabsTrigger>
            <TabsTrigger value="map" className="flex items-center gap-2">
              <Map className="h-4 w-4" />
              Map View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-4">
            {filteredIssues.length === 0 ? (
              <Card className="bg-gradient-card border-0 shadow-md">
                <CardContent className="p-8 text-center">
                  <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">No Issues Found</h3>
                  <p className="text-muted-foreground">
                    {issues.length === 0 
                      ? "No issues have been reported yet. Citizens can report issues using the reporting form."
                      : "No issues match the current filters. Try adjusting your filter criteria."
                    }
                  </p>
                </CardContent>
              </Card>
            ) : (
              filteredIssues.map((issue) => (
                <Card key={issue.id} className="bg-gradient-card border-0 shadow-md">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{issue.title}</CardTitle>
                        <CardDescription className="mt-1">{issue.description}</CardDescription>
                        {issue.aiDetectedProblem && (
                          <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 bg-info/10 border border-info/20 rounded text-xs text-info-foreground">
                            <span>🤖 AI: {issue.aiDetectedProblem}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {getStatusBadge(issue.status)}
                        {getPriorityBadge(issue.priority)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span>{issue.location}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span>{issue.reportedBy}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span>{issue.phone}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <span>{new Date(issue.reportedAt).toLocaleDateString()}</span>
                        </div>
                        {issue.assignedTo && (
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-muted-foreground" />
                            <span>Assigned to: {issue.assignedTo}</span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex gap-2 pt-4 border-t">
                        <Select onValueChange={(value) => updateIssueStatus(issue.id, value as any)}>
                          <SelectTrigger className="w-[140px]">
                            <SelectValue placeholder="Update Status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="in-progress">In Progress</SelectItem>
                            <SelectItem value="resolved">Resolved</SelectItem>
                          </SelectContent>
                        </Select>
                        
                        <Select onValueChange={(value) => assignIssue(issue.id, value)}>
                          <SelectTrigger className="w-[140px]">
                            <SelectValue placeholder="Assign Team" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Team Alpha">Team Alpha</SelectItem>
                            <SelectItem value="Team Beta">Team Beta</SelectItem>
                            <SelectItem value="Team Gamma">Team Gamma</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="map">
            <Card className="bg-gradient-card border-0 shadow-md">
              <CardHeader>
                <CardTitle>Issues Map View</CardTitle>
                <CardDescription>Geographical distribution of reported issues</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[600px] bg-muted rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <Map className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                    <p className="text-lg font-medium text-muted-foreground">Map Integration</p>
                    <p className="text-sm text-muted-foreground">Google Maps integration will be implemented here</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Dashboard;