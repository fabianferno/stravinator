import { Button } from "@/components/Button";

export interface ConnectFormProps {
  /** Where "Connect Strava" sends the athlete. Wire to the OAuth start route. */
  connectHref: string;
}

export function ConnectForm({ connectHref }: ConnectFormProps) {
  return (
    <form className="dock" action={connectHref} method="get" aria-labelledby="connect-heading">
      <h2 className="sr-only" id="connect-heading">
        Connect your Strava account
      </h2>
      <Button type="submit" variant="primary">
        Connect Strava
      </Button>
    </form>
  );
}
