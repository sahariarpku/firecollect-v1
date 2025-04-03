import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

interface FirecrawlAppOptions {
  apiKey: string;
}

interface ExtractOptions {
  prompt: string;
  schema: any;
}

interface ErrorResponse {
  success: false;
  error: string;
}

interface CrawlStatusResponse {
  success: true;
  status: string;
  completed: number;
  total: number;
  creditsUsed: number;
  expiresAt: string;
  data: any;
}

export interface CrawlProgress {
  status: string;
  completed: number;
  total: number;
  percentage: number;
}

export interface ActivityItem {
  id: string;
  type: 'analyzing' | 'success' | 'info' | 'error';
  message: string;
  timestamp: Date;
  details?: string;
}

export interface PaperData {
  name: string;
  author: string;
  year: number | null;
  abstract: string | null;
  doi: string | null;
  research_question?: string | null;
  major_findings?: string | null;
  suggestions?: string | null;
}

export interface ResultData {
  papers: PaperData[];
}

export interface CrawlResult {
  sources: string[];
  activities: ActivityItem[];
  summary?: string;
  data?: ResultData;
  searchId?: string;
}

type CrawlResponse = CrawlStatusResponse | ErrorResponse;

export class FirecrawlService {
  private static API_KEY_STORAGE_KEY = 'firecrawl_api_key';
  private static firecrawlApp: any = null;
  private static mockActivityData: ActivityItem[] = [];
  private static mockProgress: CrawlProgress = { status: '', completed: 0, total: 100, percentage: 0 };
  private static mockTimeout: ReturnType<typeof setTimeout> | null = null;
  private static mockIntervalId: ReturnType<typeof setInterval> | null = null;
  private static DEFAULT_API_KEY = "fc-71889ec5fbbd46838335b514190d059d";
  private static cachedApiKey: string | null = null;

  static async saveApiKey(apiKey: string): Promise<void> {
    try {
      console.log('Saving API key to Supabase:', apiKey);
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('User not authenticated');
        toast.error('You must be logged in to save API keys');
        return;
      }
      
      // Check if an API key already exists for this user
      const { data: existingKeys } = await supabase
        .from('firecrawl_api_keys')
        .select('id')
        .eq('user_id', user.id)
        .limit(1);
        
      if (existingKeys && existingKeys.length > 0) {
        // Update existing API key
        const { error } = await supabase
          .from('firecrawl_api_keys')
          .update({ api_key: apiKey })
          .eq('id', existingKeys[0].id)
          .eq('user_id', user.id);
          
        if (error) {
          console.error('Error updating API key:', error);
          toast.error('Failed to save API key');
          return;
        }
      } else {
        // Insert new API key
        const { error } = await supabase
          .from('firecrawl_api_keys')
          .insert({ 
            api_key: apiKey,
            user_id: user.id
          });
          
        if (error) {
          console.error('Error inserting API key:', error);
          toast.error('Failed to save API key');
          return;
        }
      }
      
      // Update cached key
      this.cachedApiKey = apiKey;
      
      console.log('API key saved successfully to Supabase');
      toast.success('API key saved successfully');
      
      this.initializeFirecrawlApp();
    } catch (error) {
      console.error('Error saving API key:', error);
      toast.error('Failed to save API key');
    }
  }

  static async getApiKey(): Promise<string> {
    // If we have a cached key, return it
    if (this.cachedApiKey) {
      return this.cachedApiKey;
    }
    
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('User not authenticated');
        return this.DEFAULT_API_KEY;
      }

      // Try to get the API key from Supabase
      const { data, error } = await supabase
        .from('firecrawl_api_keys')
        .select('api_key')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
        
      if (error) {
        console.error('Error fetching API key:', error);
        return this.DEFAULT_API_KEY;
      }
      
      if (data && data.api_key) {
        this.cachedApiKey = data.api_key;
        return data.api_key;
      }
    } catch (error) {
      console.error('Error retrieving API key:', error);
    }
    
    return this.DEFAULT_API_KEY;
  }

  static async hasApiKey(): Promise<boolean> {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('User not authenticated');
        return false;
      }

      // Check if we have an API key in Supabase
      const { data, error } = await supabase
        .from('firecrawl_api_keys')
        .select('api_key')
        .eq('user_id', user.id)
        .limit(1);
        
      if (error) {
        console.error('Error checking for API key:', error);
        return false;
      }
      
      return !!(data && data.length > 0);
    } catch (error) {
      console.error('Error checking for API key:', error);
      return false;
    }
  }

  private static async initializeFirecrawlApp() {
    try {
      const apiKey = await this.getApiKey();
      
      const FirecrawlAppModule = await import('@mendable/firecrawl-js');
      const FirecrawlApp = FirecrawlAppModule.default;
      
      this.firecrawlApp = new FirecrawlApp({ apiKey });
      console.log('Firecrawl app initialized successfully');
      return true;
    } catch (error) {
      console.error('Error initializing Firecrawl app:', error);
      return false;
    }
  }

  static createActivityItem(type: 'analyzing' | 'success' | 'info' | 'error', message: string, details?: string): ActivityItem {
    return {
      id: Math.random().toString(36).substring(2, 9),
      type,
      message,
      timestamp: new Date(),
      details
    };
  }

  static async saveSearchQuery(query: string): Promise<string | null> {
    try {
      console.log('Saving search query to Supabase:', query);
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('User not authenticated');
        return null;
      }

      const { data, error } = await supabase
        .from('searches')
        .insert({ 
          query,
          user_id: user.id
        })
        .select('id')
        .single();
      
      if (error) {
        console.error('Error saving search query:', error);
        return null;
      }
      
      console.log('Search saved successfully with ID:', data.id);
      return data.id;
    } catch (error) {
      console.error('Error saving search query:', error);
      return null;
    }
  }

  static async savePapers(papers: any[], searchId: string): Promise<void> {
    try {
      if (!papers || papers.length === 0) {
        console.log('No papers to save');
        return;
      }
      
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('User not authenticated');
        throw new Error('User not authenticated');
      }
      
      console.log(`Saving ${papers.length} papers with search_id:`, searchId);
      
      // Transform papers to match the database schema
      const papersWithSearchId = papers.map(paper => ({
        name: paper.name || '',
        author: paper.author || 'Unknown',
        year: paper.year || null,
        abstract: paper.abstract || null,
        doi: paper.doi || null,
        search_id: searchId,
        user_id: user.id
      }));
      
      // Save papers in batches to avoid overwhelming the database
      const batchSize = 50;
      for (let i = 0; i < papersWithSearchId.length; i += batchSize) {
        const batch = papersWithSearchId.slice(i, i + batchSize);
        const { error } = await supabase
          .from('papers')
          .insert(batch);
        
        if (error) {
          console.error('Error saving papers batch:', error);
          throw error;
        }
        
        console.log(`Saved batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(papersWithSearchId.length / batchSize)}`);
      }
      
      console.log('All papers saved successfully');
    } catch (error) {
      console.error('Error saving papers:', error);
      throw error; // Re-throw to handle in the calling function
    }
  }

  static async processQuery(query: string, 
    onProgressUpdate: (progress: CrawlProgress) => void,
    onActivityUpdate: (activities: ActivityItem[]) => void
  ): Promise<CrawlResult> {
    this.cancelCurrentSearch();
    
    const activities: ActivityItem[] = [];
    const sources: string[] = [];
    let progress: CrawlProgress = { 
      status: 'Research in progress...', 
      completed: 0, 
      total: 100, 
      percentage: 0 
    };
    
    onProgressUpdate(progress);
    
    try {
      const searchId = await this.saveSearchQuery(query);
      
      if (!searchId) {
        console.error('Failed to get search ID');
        activities.push(this.createActivityItem('error', 'Failed to save search to database'));
        onActivityUpdate([...activities]);
        throw new Error('Failed to save search query');
      } else {
        console.log('Got search ID:', searchId);
        activities.push(this.createActivityItem('info', 'Search query saved successfully'));
      }
      
      if (!this.firecrawlApp) {
        const initialized = await this.initializeFirecrawlApp();
        if (!initialized) {
          throw new Error('Failed to initialize Firecrawl app');
        }
      }
      
      activities.push(this.createActivityItem('analyzing', `Starting research for: "${query}"`));
      onActivityUpdate([...activities]);
      
      const paperSchema = {
        type: "object",
        properties: {
          papers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                author: { type: "string" },
                year: { type: "number" },
                abstract: { type: "string" },
                doi: { type: "string" },
                research_question: { type: "string" },
                major_findings: { type: "string" },
                suggestions: { type: "string" }
              },
              required: ["name", "author", "year"]
            }
          }
        }
      };
      
      activities.push(this.createActivityItem('analyzing', 'Searching scholarly databases...'));
      onActivityUpdate([...activities]);
      
      this.mockIntervalId = setInterval(() => {
        progress.completed += 2;
        progress.percentage = Math.min(99, Math.floor((progress.completed / progress.total) * 100));
        onProgressUpdate({...progress});
        
        if (progress.completed >= 95) {
          clearInterval(this.mockIntervalId!);
        }
      }, 200);
      
      try {
        console.log('Making Firecrawl API request with query:', query);
        console.log('Using API key:', await this.getApiKey());
        
        const extractResult = await this.firecrawlApp.extract([
          "https://scholar.google.com/*", 
          "https://researchgate.net/*"
        ], {
          prompt: `Search for papers related to topic given below on different scholarly databases. Extract the paper's name, author, year, abstract, and DOI. Ensure that the name, author, year, and DOI are included for each paper.

          topic is: ${query}`,
          schema: paperSchema,
        });
        
        console.log('Firecrawl API response:', extractResult);
        
        if (!extractResult || !extractResult.data) {
          throw new Error('Invalid response from Firecrawl API');
        }
        
        if (this.mockIntervalId) {
          clearInterval(this.mockIntervalId);
        }
        
        sources.push("https://scholar.google.com");
        sources.push("https://researchgate.net");
        
        activities.push(this.createActivityItem('success', 'Research completed successfully'));
        
        if (extractResult.data?.papers?.length > 0) {
          try {
            console.log('Attempting to save papers:', extractResult.data.papers.length);
            await this.savePapers(extractResult.data.papers, searchId);
            
            activities.push(this.createActivityItem(
              'success', 
              `Found and saved ${extractResult.data.papers.length} relevant papers`, 
              `Extracted and saved information about ${extractResult.data.papers.length} papers related to "${query}"`
            ));
          } catch (error) {
            console.error('Error saving papers:', error);
            activities.push(this.createActivityItem(
              'error',
              'Failed to save papers to database',
              error instanceof Error ? error.message : 'Unknown error'
            ));
            throw error;
          }
        } else {
          activities.push(this.createActivityItem('info', 'No papers found matching the criteria'));
        }
        
        progress.completed = progress.total;
        progress.percentage = 100;
        progress.status = 'Research completed';
        onProgressUpdate({...progress});
        onActivityUpdate([...activities]);
        
        return {
          searchId,
          sources,
          activities,
          summary: `Completed research on "${query}". ${extractResult.data?.papers?.length ? `Found and saved ${extractResult.data.papers.length} papers related to the topic.` : 'No specific papers were found.'}`,
          data: extractResult.data
        };
      } catch (error) {
        console.error('Error in Firecrawl API request:', error);
        activities.push(this.createActivityItem(
          'error',
          'Failed to connect to Firecrawl API',
          error instanceof Error ? error.message : 'Network error occurred'
        ));
        throw error;
      }
    } catch (error) {
      console.error('Error in search:', error);
      
      activities.push(this.createActivityItem('error', 'An error occurred during research', 
        error instanceof Error ? error.message : 'Unknown error'));
      
      onActivityUpdate([...activities]);
      
      progress.status = 'Research failed';
      progress.percentage = 100;
      onProgressUpdate({...progress});
      
      return {
        sources,
        activities,
        summary: `Research on "${query}" encountered an error.`
      };
    }
  }

  static cancelCurrentSearch(): void {
    if (this.mockIntervalId) {
      clearInterval(this.mockIntervalId);
      this.mockIntervalId = null;
    }
    if (this.mockTimeout) {
      clearTimeout(this.mockTimeout);
      this.mockTimeout = null;
    }
  }
}
