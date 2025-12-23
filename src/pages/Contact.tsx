import { useState } from "react";
import { Send } from "lucide-react";

export default function Contact() {
  const [formState, setFormState] = useState({
    name: '',
    email: '',
    message: '',
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Placeholder for actual submission
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen pt-24 pb-16">
      <div className="container-narrow">
        <div className="max-w-xl mx-auto">
          <div className="text-center mb-12 opacity-0 animate-fade-up">
            <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-4">
              Get in touch
            </h1>
            <p className="text-muted-foreground">
              Questions, feedback, or partnership inquiries.
            </p>
          </div>

          {submitted ? (
            <div className="text-center py-12 opacity-0 animate-fade-up" style={{ animationDelay: '100ms' }}>
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <Send className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-medium text-foreground mb-2">
                Message sent
              </h2>
              <p className="text-muted-foreground">
                We'll get back to you as soon as possible.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 opacity-0 animate-fade-up" style={{ animationDelay: '100ms' }}>
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Name</label>
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  className="input-field w-full"
                />
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-2">Email</label>
                <input
                  type="email"
                  required
                  value={formState.email}
                  onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                  className="input-field w-full"
                />
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-2">Message</label>
                <textarea
                  required
                  rows={5}
                  value={formState.message}
                  onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                  className="input-field w-full resize-none"
                />
              </div>

              <button type="submit" className="btn-primary w-full">
                Send message
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
