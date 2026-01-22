ALTER TABLE `users` ADD `unix_uid` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `unix_gid` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `github_username` text;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `container_name` text;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `container_status` text;--> statement-breakpoint
ALTER TABLE `worktrees` ADD `ssh_port` integer;