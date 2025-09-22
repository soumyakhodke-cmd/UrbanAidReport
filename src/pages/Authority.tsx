import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shield, LogIn } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Dashboard from '@/components/Dashboard';

const Authority = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [credentials, setCredentials] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Check credentials
    if (credentials.email === 'altf4@gmail.com' && credentials.password === 'altf4#123') {
      setTimeout(() => {
        setIsAuthenticated(true);
        setLoading(false);
        toast({
          title: "Login successful",
          description: "Welcome to the Authority Dashboard",
        });
      }, 1000);
    } else {
      setTimeout(() => {
        setLoading(false);
        toast({
          title: "Authentication failed",
          description: "Invalid email or password",
          variant: "destructive",
        });
      }, 1000);
    }
  };

  if (isAuthenticated) {
    return <Dashboard />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-gradient-card shadow-xl border-0">
        <CardHeader className="bg-gradient-primary text-primary-foreground rounded-t-lg text-center">
          <div className="flex justify-center mb-4">
            <Shield className="h-12 w-12" />
          </div>
          <CardTitle className="text-2xl">Authority Access</CardTitle>
          <CardDescription className="text-primary-foreground/80">
            Sign in to access the dashboard
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={credentials.email}
                onChange={(e) => setCredentials(prev => ({ ...prev, email: e.target.value }))}
                placeholder="Enter your email"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={credentials.password}
                onChange={(e) => setCredentials(prev => ({ ...prev, password: e.target.value }))}
                placeholder="Enter your password"
                required
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-primary hover:opacity-90 transition-opacity"
              size="lg"
            >
              {loading ? (
                'Authenticating...'
              ) : (
                <>
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign In
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Authority;