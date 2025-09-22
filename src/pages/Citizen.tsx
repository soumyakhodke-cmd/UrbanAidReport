import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MapPin, Camera, Upload, MapIcon as Map, Navigation, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const Citizen = () => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    location: '',
    description: '',
    image: null as File | null
  });
  const [locationMethod, setLocationMethod] = useState<'manual' | 'gps'>('manual');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData(prev => ({ ...prev, image: file }));
    }
  };

  const detectLocation = () => {
    setLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setFormData(prev => ({
            ...prev,
            location: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
          }));
          setLoading(false);
          toast({
            title: "Location detected",
            description: "Your current location has been captured.",
          });
        },
        (error) => {
          console.error('Error getting location:', error);
          setLoading(false);
          toast({
            title: "Location error",
            description: "Unable to detect your location. Please enter manually.",
            variant: "destructive",
          });
        }
      );
    } else {
      setLoading(false);
      toast({
        title: "Geolocation not supported",
        description: "Please enter your location manually.",
        variant: "destructive",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone || !formData.location) {
      toast({
        title: "Missing information",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    
    // Simulate API call
    setTimeout(() => {
      setLoading(false);
      toast({
        title: "Report submitted successfully",
        description: "Thank you for reporting this issue. Authorities have been notified.",
      });
      setFormData({
        name: '',
        phone: '',
        location: '',
        description: '',
        image: null
      });
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="text-center flex-1">
            <h1 className="text-3xl font-bold text-foreground mb-2">Report an Issue</h1>
            <p className="text-muted-foreground">Help keep your community clean and safe</p>
          </div>
          <Link to="/">
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
        </div>

        <Card className="bg-gradient-card shadow-xl border-0">
          <CardHeader className="bg-gradient-primary text-primary-foreground rounded-t-lg">
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Submit New Report
            </CardTitle>
            <CardDescription className="text-primary-foreground/80">
              Provide details about the sanitation or waste issue
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name *</Label>
                  <Input
                    id="name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Enter your full name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="Enter your phone number"
                    required
                  />
                </div>
              </div>

              <div className="space-y-4">
                <Label>Location Method</Label>
                <div className="flex gap-4">
                  <Button
                    type="button"
                    variant={locationMethod === 'manual' ? 'default' : 'outline'}
                    onClick={() => setLocationMethod('manual')}
                    className="flex items-center gap-2"
                  >
                    <Map className="h-4 w-4" />
                    Manual Entry
                  </Button>
                  <Button
                    type="button"
                    variant={locationMethod === 'gps' ? 'default' : 'outline'}
                    onClick={() => {
                      setLocationMethod('gps');
                      detectLocation();
                    }}
                    disabled={loading}
                    className="flex items-center gap-2"
                  >
                    <Navigation className="h-4 w-4" />
                    {loading ? 'Detecting...' : 'Auto Detect'}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">Location *</Label>
                {locationMethod === 'manual' ? (
                  <Textarea
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                    placeholder="Enter the location of the issue (address, landmark, etc.)"
                    required
                  />
                ) : (
                  <Input
                    id="location"
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                    placeholder="GPS coordinates will appear here"
                    required
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="image">Upload Photo</Label>
                <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                  <input
                    id="image"
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <Label htmlFor="image" className="cursor-pointer">
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        {formData.image ? formData.image.name : 'Click to upload a photo of the issue'}
                      </span>
                    </div>
                  </Label>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Additional Description (Optional)</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Provide any additional details about the issue"
                  rows={3}
                />
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-primary hover:opacity-90 transition-opacity"
                size="lg"
              >
                {loading ? 'Submitting...' : 'Submit Report'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Citizen;