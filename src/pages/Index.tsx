import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Shield, MapPin, Camera, AlertTriangle, CheckCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      {/* Hero Section */}
      <div className="bg-gradient-hero text-primary-foreground">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <div className="text-center">
            <h1 className="text-4xl md:text-6xl font-bold mb-6">
              Smart Sanitation & Waste Reporting
            </h1>
            <p className="text-xl md:text-2xl mb-8 opacity-90 max-w-3xl mx-auto">
              Empowering citizens to report sanitation issues and helping authorities manage them efficiently
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link to="/citizen">
                <Button size="lg" variant="secondary" className="text-lg px-8 py-6 bg-secondary hover:bg-secondary/90">
                  <Users className="mr-2 h-5 w-5" />
                  Report an Issue
                </Button>
              </Link>
              <Link to="/authority">
                <Button size="lg" variant="outline" className="text-lg px-8 py-6 border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary">
                  <Shield className="mr-2 h-5 w-5" />
                  Authority Access
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">How It Works</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            A simple and effective system to keep our communities clean and well-maintained
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          {/* Citizen Features */}
          <Card className="bg-gradient-card border-0 shadow-xl">
            <CardHeader className="bg-gradient-secondary text-secondary-foreground rounded-t-lg">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Users className="h-6 w-6" />
                For Citizens
              </CardTitle>
              <CardDescription className="text-secondary-foreground/80">
                Quick and easy issue reporting
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Camera className="h-5 w-5 text-secondary mt-1" />
                  <div>
                    <h4 className="font-semibold">Photo Upload</h4>
                    <p className="text-sm text-muted-foreground">Capture and upload images of issues</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-secondary mt-1" />
                  <div>
                    <h4 className="font-semibold">Location Detection</h4>
                    <p className="text-sm text-muted-foreground">Auto-detect or manually enter location</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-secondary mt-1" />
                  <div>
                    <h4 className="font-semibold">AI Recognition</h4>
                    <p className="text-sm text-muted-foreground">AI automatically identifies problem types</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Authority Features */}
          <Card className="bg-gradient-card border-0 shadow-xl">
            <CardHeader className="bg-gradient-primary text-primary-foreground rounded-t-lg">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Shield className="h-6 w-6" />
                For Authorities
              </CardTitle>
              <CardDescription className="text-primary-foreground/80">
                Comprehensive management dashboard
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-primary mt-1" />
                  <div>
                    <h4 className="font-semibold">Map & List View</h4>
                    <p className="text-sm text-muted-foreground">Visualize issues on map or detailed lists</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Users className="h-5 w-5 text-primary mt-1" />
                  <div>
                    <h4 className="font-semibold">Team Assignment</h4>
                    <p className="text-sm text-muted-foreground">Assign issues to field staff teams</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <CheckCircle className="h-5 w-5 text-primary mt-1" />
                  <div>
                    <h4 className="font-semibold">Status Tracking</h4>
                    <p className="text-sm text-muted-foreground">Real-time updates on issue resolution</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Call to Action */}
        <div className="text-center">
          <h3 className="text-2xl font-bold text-foreground mb-4">Ready to Get Started?</h3>
          <p className="text-muted-foreground mb-8">Choose your role to begin making a difference in your community</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/citizen">
              <Button size="lg" className="bg-gradient-secondary hover:opacity-90 transition-opacity">
                <Users className="mr-2 h-5 w-5" />
                I'm a Citizen
              </Button>
            </Link>
            <Link to="/authority">
              <Button size="lg" variant="outline">
                <Shield className="mr-2 h-5 w-5" />
                I'm an Authority
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
